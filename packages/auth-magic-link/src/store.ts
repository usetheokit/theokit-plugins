/**
 * @theokit/auth-magic-link — built-in MagicLinkStore adapters.
 *
 * Per plan G11 ADR D7 (pluggable storage):
 *   - createMemoryStore: dev/test only — single-process, lost on restart.
 *     Atomic via single-threaded JS event loop + Map operations.
 *   - createOrmStore: production — pluggable Repository<MagicLinkRow> (any
 *     ORM that satisfies the minimal Repository interface). Atomicity via
 *     UPDATE...RETURNING (Postgres/MySQL/SQLite) — implementation detail
 *     lives in the Repository contract, NOT here.
 */

import { createHash } from 'node:crypto'

import type { MagicLinkStore, MagicLinkTokenRecord } from './types.js'

interface MemoryEntry {
  email: string
  expiresAt: Date
}

/**
 * Hash a magic-link token for storage/lookup (#191). Tokens are 32-byte
 * high-entropy `crypto.randomBytes` values, so an UNSALTED SHA-256 is correct
 * here (EC-12): there is no rainbow-table/brute-force surface as with low-entropy
 * passwords, so a salt/KDF (bcrypt/argon2) is unnecessary. A store/DB/log leak
 * then exposes only hashes, not live credentials. The raw token never rests.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * In-process token store, for development and tests.
 *
 * State lives in a `Map`, so it is lost on restart and is not shared between processes: a
 * multi-instance deployment would issue a link on one node that another cannot consume. Use
 * {@link createOrmStore} for anything that outlives a single process.
 */
export function createMemoryStore(): MagicLinkStore {
  // Keyed by sha256(token) — the raw token is never stored (#191).
  const tokens = new Map<string, MemoryEntry>()

  return {
    createToken({ email, token, expiresAt }) {
      tokens.set(hashToken(token), { email, expiresAt })
      return Promise.resolve()
    },
    consumeToken({ token }) {
      // EC-11 atomicity: read + delete in a single sync turn — JS event loop
      // guarantees no interleave between two concurrent consumeToken calls
      // on the in-memory adapter. Lookup is by hash (#191).
      const key = hashToken(token)
      const entry = tokens.get(key)
      if (!entry) return Promise.resolve(null)
      tokens.delete(key)
      if (entry.expiresAt.getTime() <= Date.now()) return Promise.resolve(null)
      const record: MagicLinkTokenRecord = { email: entry.email, expiresAt: entry.expiresAt }
      return Promise.resolve(record)
    },
    revokeToken({ token }) {
      tokens.delete(hashToken(token))
      return Promise.resolve()
    },
    cleanupExpired() {
      const now = Date.now()
      let removed = 0
      for (const [key, entry] of tokens) {
        if (entry.expiresAt.getTime() <= now) {
          tokens.delete(key)
          removed += 1
        }
      }
      return Promise.resolve(removed)
    },
  }
}

/**
 * Minimal Repository interface that a @theokit/orm Repository satisfies.
 * Apps using @theokit/orm pass `orm.getRepository(MagicLinkRow)` directly.
 * The store does NOT depend on @theokit/orm at type level — any adapter
 * satisfying this surface works (Drizzle, Prisma, hand-rolled SQL).
 */
export interface MagicLinkRepository {
  insert(row: {
    token: string
    email: string
    expiresAt: Date
    consumedAt: Date | null
  }): Promise<void>
  /**
   * Atomically mark the token consumed and return the row. MUST be a single
   * SQL UPDATE...RETURNING (or equivalent) so concurrent callers race on
   * the row lock and only one observes consumedAt === null.
   */
  consumeAtomically(token: string, now: Date): Promise<{ email: string; expiresAt: Date } | null>
  delete(token: string): Promise<void>
  deleteExpired(now: Date): Promise<number>
}

/**
 * Persistent token store backed by a repository the consumer supplies.
 *
 * Single-use is enforced by the repository's atomic consume, not by a read-then-write here, because
 * the two concurrent clicks that must resolve to one winner are a race a check-then-act cannot win.
 * Tokens are hashed before they reach the repository, so a database or log leak exposes digests
 * rather than live credentials.
 */
export function createOrmStore(repo: MagicLinkRepository): MagicLinkStore {
  // Tokens are hashed before they reach the repository (#191) — the persisted
  // `token` column holds sha256(token), never the raw credential. Lookups hash
  // the incoming raw token, so the atomic UPDATE...RETURNING semantics are
  // unchanged (only the matched key differs).
  return {
    async createToken({ email, token, expiresAt }) {
      await repo.insert({ token: hashToken(token), email, expiresAt, consumedAt: null })
    },
    async consumeToken({ token }) {
      const row = await repo.consumeAtomically(hashToken(token), new Date())
      if (!row) return null
      if (row.expiresAt.getTime() <= Date.now()) return null
      return { email: row.email, expiresAt: row.expiresAt }
    },
    async revokeToken({ token }) {
      await repo.delete(hashToken(token))
    },
    async cleanupExpired() {
      return repo.deleteExpired(new Date())
    },
  }
}
