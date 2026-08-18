/**
 * `createOrmStore` against a real database, and against a repository that gets the one
 * requirement wrong.
 *
 * The interface states the requirement in prose (`store.ts:85-89`):
 *
 *   "Atomically mark the token consumed and return the row. MUST be a single SQL
 *    UPDATE...RETURNING (or equivalent) so concurrent callers race on the row lock and
 *    only one observes consumedAt === null."
 *
 * Nothing verified it. The existing suite covers `createOrmStore` through an in-memory
 * `MagicLinkRepository`, which is atomic by construction — JavaScript is single-threaded,
 * so a fake cannot fail the way SQL can. The requirement therefore held in every test and
 * in none of the code a consumer actually writes: the plugin hashes the token and hands it
 * to `repo.consumeAtomically`, and the SQL belongs to whoever implements the repository.
 *
 * A repository that does SELECT-then-UPDATE instead loses single-use, and a magic-link
 * token that can be consumed twice is an authentication bypass — anyone who reads the link
 * over the owner's shoulder, or out of a proxy log, signs in after them.
 *
 * So this suite implements the repository twice against the same real SQLite database:
 *
 *   atomicRepo   one `UPDATE … WHERE consumedAt IS NULL RETURNING …`
 *   naiveRepo    SELECT, then UPDATE, with an await between them
 *
 * and asserts the first survives a concurrent race the second loses. The naive case is not
 * a strawman: it is the shape most people write first, and proving it fails is what makes
 * the word "atomically" in the interface mean something checkable.
 *
 * On SQLite being synchronous: better-sqlite3 runs statements to completion, so the
 * interleaving window in `naiveRepo` is its `await`, not the driver's I/O. That models a
 * real async driver (pg, mysql2) faithfully — the window exists there for the same reason,
 * between two round trips — and it is the only place a race can open in this process.
 */

import { createHash } from 'node:crypto'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createOrmStore, type MagicLinkRepository } from '../../src/store.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE magic_link (
      token      TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      expiresAt  INTEGER NOT NULL,
      consumedAt INTEGER
    )
  `)
})

afterEach(() => {
  db.close()
})

interface Row {
  token: string
  email: string
  expiresAt: number
  consumedAt: number | null
}

/** Shared by both repositories: only `consumeAtomically` differs. */
function baseRepo(): Omit<MagicLinkRepository, 'consumeAtomically'> {
  return {
    insert(row) {
      db.prepare(
        'INSERT INTO magic_link (token, email, expiresAt, consumedAt) VALUES (?, ?, ?, ?)',
      ).run(row.token, row.email, row.expiresAt.getTime(), row.consumedAt?.getTime() ?? null)
      return Promise.resolve()
    },
    delete(token) {
      db.prepare('DELETE FROM magic_link WHERE token = ?').run(token)
      return Promise.resolve()
    },
    deleteExpired(now) {
      const info = db.prepare('DELETE FROM magic_link WHERE expiresAt <= ?').run(now.getTime())
      return Promise.resolve(info.changes)
    },
  }
}

/** What the interface asks for: one statement, the row lock does the arbitration. */
function atomicRepo(): MagicLinkRepository {
  return {
    ...baseRepo(),
    consumeAtomically(token, now) {
      const rows = db
        .prepare(
          `UPDATE magic_link SET consumedAt = ?
             WHERE token = ? AND consumedAt IS NULL
           RETURNING email, expiresAt`,
        )
        .all(now.getTime(), token) as Pick<Row, 'email' | 'expiresAt'>[]
      const row = rows[0]
      return Promise.resolve(
        row === undefined ? null : { email: row.email, expiresAt: new Date(row.expiresAt) },
      )
    },
  }
}

/** The shape most people write first, and the one the interface's wording forbids. */
function naiveRepo(): MagicLinkRepository {
  return {
    ...baseRepo(),
    async consumeAtomically(token, now) {
      const row = db
        .prepare('SELECT email, expiresAt, consumedAt FROM magic_link WHERE token = ?')
        .get(token) as Row | undefined
      if (row === undefined || row.consumedAt !== null) return null

      // The window. A real driver opens it on I/O between the two round trips; here the
      // await is the same yield point, and it is what both callers slip through.
      await Promise.resolve()

      db.prepare('UPDATE magic_link SET consumedAt = ? WHERE token = ?').run(now.getTime(), token)
      return { email: row.email, expiresAt: new Date(row.expiresAt) }
    },
  }
}

const RAW_TOKEN = 'a-token-a-user-received-in-an-email'
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

async function seed(repo: MagicLinkRepository, lifetimeMs = 15 * 60_000) {
  const store = createOrmStore(repo)
  await store.createToken({
    email: 'user@example.test',
    token: RAW_TOKEN,
    expiresAt: new Date(Date.now() + lifetimeMs),
  })
  return store
}

describe('createOrmStore against a real sqlite database', () => {
  it('stores the hash, never the token the user holds', async () => {
    await seed(atomicRepo())

    const stored = db.prepare('SELECT token FROM magic_link').all() as { token: string }[]
    expect(stored).toHaveLength(1)
    // Read the column, not a mock's argument: this is the assertion that would catch a
    // future refactor writing the raw credential to disk.
    expect(stored[0]?.token).toBe(sha256(RAW_TOKEN))
    expect(stored[0]?.token).not.toBe(RAW_TOKEN)
  })

  it('a full round trip returns the email and marks the row consumed', async () => {
    const store = await seed(atomicRepo())

    const result = await store.consumeToken({ token: RAW_TOKEN })
    expect(result?.email).toBe('user@example.test')

    const row = db.prepare('SELECT consumedAt FROM magic_link').get() as Row
    expect(row.consumedAt, 'the row was not marked consumed in the database').not.toBeNull()
  })

  it('an atomic repository lets exactly one of two concurrent consumers win', async () => {
    const store = await seed(atomicRepo())

    const [a, b] = await Promise.all([
      store.consumeToken({ token: RAW_TOKEN }),
      store.consumeToken({ token: RAW_TOKEN }),
    ])

    expect([a, b].filter((r) => r !== null), 'both callers consumed the same token').toHaveLength(1)
  })

  it('a SELECT-then-UPDATE repository loses single-use — which is why the interface forbids it', async () => {
    const store = await seed(naiveRepo())

    const [a, b] = await Promise.all([
      store.consumeToken({ token: RAW_TOKEN }),
      store.consumeToken({ token: RAW_TOKEN }),
    ])

    // Asserting the FAILURE deliberately. If a future change made the naive shape safe
    // this test goes red and should be re-read rather than deleted — but as long as it is
    // unsafe, this is the evidence that `consumeAtomically`'s wording is load-bearing and
    // not decoration. A token consumed twice is an authentication bypass.
    expect(
      [a, b].filter((r) => r !== null),
      'the naive repository somehow held single-use — re-read this test before trusting it',
    ).toHaveLength(2)
  })

  it('an expired token is refused even though the row was matched and updated', async () => {
    // The expiry check lives in `createOrmStore`, after the repository returns. So the row
    // IS consumed and the caller still gets null — worth pinning, because it means an
    // expired link cannot be retried into a valid one.
    const store = await seed(atomicRepo(), -1_000)

    expect(await store.consumeToken({ token: RAW_TOKEN })).toBeNull()

    const row = db.prepare('SELECT consumedAt FROM magic_link').get() as Row
    expect(row.consumedAt, 'the expired row was left claimable').not.toBeNull()
  })

  it('cleanupExpired deletes only what has expired, and reports how many', async () => {
    const store = createOrmStore(atomicRepo())
    await store.createToken({
      email: 'fresh@example.test',
      token: 'fresh',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await store.createToken({
      email: 'stale@example.test',
      token: 'stale',
      expiresAt: new Date(Date.now() - 60_000),
    })

    expect(await store.cleanupExpired()).toBe(1)
    const left = db.prepare('SELECT email FROM magic_link').all() as { email: string }[]
    expect(left.map((r) => r.email)).toEqual(['fresh@example.test'])
  })

  it('revokeToken removes the row by hash', async () => {
    const store = await seed(atomicRepo())
    await store.revokeToken({ token: RAW_TOKEN })

    expect(db.prepare('SELECT COUNT(*) c FROM magic_link').get()).toEqual({ c: 0 })
  })
})
