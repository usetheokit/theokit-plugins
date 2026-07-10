/**
 * Artifact storage — adapter interface + two reference implementations.
 *
 *   - `createInMemoryArtifactStore()` — Map-backed, ideal for dev /
 *     ephemeral sessions / tests
 *   - `createSqliteArtifactStore({ db })` — better-sqlite3-shaped
 *     adapter; matches the dogfood-app's existing storage pattern
 *
 * The plugin does NOT take a hard dep on `better-sqlite3`. The SQLite
 * factory accepts a structural shape (`prepare(sql).run/get/all`)
 * exposed by better-sqlite3, bun:sqlite, expo-sqlite, and node's own
 * `node:sqlite`. Tests use the in-memory variant.
 *
 * Versioning semantics:
 *   - `insert(artifact)` always stores at the supplied version. If the
 *     same `(id, version)` already exists the store throws.
 *   - `nextVersion(id)` returns the highest stored version + 1 (or 1
 *     when no row exists). Use it before `insert` to avoid races: the
 *     final write is what wins.
 *   - `delete(id, version?)` drops one version (or all when `version`
 *     is omitted).
 */

import { CanvasArtifactNotFoundError, CanvasPluginError } from './errors.js'
import { type Artifact, validateArtifact } from './schema.js'

export interface ArtifactListFilter {
  sessionId?: string
  kind?: Artifact['kind']
  /** Return the latest version per id (default) or every version. */
  mode?: 'latest' | 'all'
  /** Inclusive offset for pagination. Default 0. */
  offset?: number
  /** Max rows. Default 200. */
  limit?: number
}

export interface ArtifactStore {
  insert(artifact: Artifact): Promise<Artifact>
  get(id: string, version?: number): Promise<Artifact | null>
  getVersions(id: string): Promise<Artifact[]>
  list(filter?: ArtifactListFilter): Promise<Artifact[]>
  nextVersion(id: string): Promise<number>
  delete(id: string, version?: number): Promise<void>
}

// ───── In-memory ─────

export function createInMemoryArtifactStore(): ArtifactStore {
  // #182: thin delegating factory; each operation lives in a named helper to
  // keep cyclomatic complexity low (behavior unchanged). `byId` is id → versions
  // ordered ascending by version.
  const byId = new Map<string, Artifact[]>()
  // Each helper below can throw synchronously (validation, version
  // conflict, not-found). The store contract is Promise-based, so a
  // throw MUST surface as a rejected promise — never a synchronous
  // throw. `Promise.resolve().then(fn)` both defers the call (so throws
  // reject) and keeps the method non-`async` (no bare `await`, satisfies
  // require-await without changing the Promise contract).
  return {
    insert(artifact) {
      return Promise.resolve().then(() => memInsert(byId, artifact))
    },
    get(id, version) {
      return Promise.resolve().then(() => memGet(byId, id, version))
    },
    getVersions(id) {
      return Promise.resolve().then(() => byId.get(id)?.slice() ?? [])
    },
    list(filter = {}) {
      return Promise.resolve().then(() => memList(byId, filter))
    },
    nextVersion(id) {
      return Promise.resolve().then(() => memNextVersion(byId, id))
    },
    delete(id, version) {
      return Promise.resolve().then(() => {
        memDelete(byId, id, version)
      })
    },
  }
}

function memInsert(byId: Map<string, Artifact[]>, artifact: Artifact): Artifact {
  const validation = validateArtifact(artifact)
  if (!validation.ok) throw validation.error
  const existing = byId.get(artifact.id) ?? []
  if (existing.some((a) => a.version === artifact.version)) {
    throw new CanvasPluginError(
      `Artifact "${artifact.id}" already has a version ${artifact.version}.`,
    )
  }
  const next = [...existing, validation.artifact].sort((a, b) => a.version - b.version)
  byId.set(artifact.id, next)
  return validation.artifact
}

function memGet(
  byId: Map<string, Artifact[]>,
  id: string,
  version: number | undefined,
): Artifact | null {
  const versions = byId.get(id)
  if (versions === undefined || versions.length === 0) return null
  if (version === undefined) return versions[versions.length - 1] ?? null
  return versions.find((a) => a.version === version) ?? null
}

function memMatchesFilter(a: Artifact, filter: ArtifactListFilter): boolean {
  if (filter.sessionId !== undefined && a.sessionId !== filter.sessionId) return false
  if (filter.kind !== undefined && a.kind !== filter.kind) return false
  return true
}

function memList(byId: Map<string, Artifact[]>, filter: ArtifactListFilter): Artifact[] {
  const mode = filter.mode ?? 'latest'
  const offset = filter.offset ?? 0
  const limit = filter.limit ?? 200
  const rows: Artifact[] = []
  for (const versions of byId.values()) {
    const candidates = mode === 'latest' ? [versions[versions.length - 1]] : versions
    for (const a of candidates) {
      if (a !== undefined && memMatchesFilter(a, filter)) rows.push(a)
    }
  }
  rows.sort((a, b) => {
    const ay = typeof a.createdAt === 'string' ? Date.parse(a.createdAt) : a.createdAt
    const by = typeof b.createdAt === 'string' ? Date.parse(b.createdAt) : b.createdAt
    return by - ay
  })
  return rows.slice(offset, offset + limit)
}

function memNextVersion(byId: Map<string, Artifact[]>, id: string): number {
  const versions = byId.get(id)
  if (versions === undefined || versions.length === 0) return 1
  return (versions[versions.length - 1]?.version ?? 0) + 1
}

function memDelete(byId: Map<string, Artifact[]>, id: string, version: number | undefined): void {
  const versions = byId.get(id)
  if (versions === undefined) {
    if (version === undefined) return
    throw new CanvasArtifactNotFoundError(id)
  }
  if (version === undefined) {
    byId.delete(id)
    return
  }
  const next = versions.filter((a) => a.version !== version)
  if (next.length === versions.length) {
    throw new CanvasArtifactNotFoundError(`${id}@v${version}`)
  }
  if (next.length === 0) byId.delete(id)
  else byId.set(id, next)
}

// ───── SQLite adapter ─────

/**
 * Structural shape that matches better-sqlite3 / node:sqlite /
 * bun:sqlite. The plugin only uses `prepare(sql).run|get|all` so any
 * driver that ships those methods works.
 */
export interface SqliteDb {
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  exec?(sql: string): void
}

export interface CreateSqliteArtifactStoreOptions {
  db: SqliteDb
  /** Table name. Default `canvas_artifacts`. */
  table?: string
  /** When `true`, runs the migration on construction. Default true. */
  autoMigrate?: boolean
}

interface ArtifactRow {
  id: string
  version: number
  session_id: string | null
  kind: string
  title: string
  payload: string // JSON blob of the artifact (sans envelope columns)
  created_at: string
}

function rowToArtifact(row: ArtifactRow): Artifact {
  const payload = JSON.parse(row.payload) as Record<string, unknown>
  const candidate = {
    ...payload,
    id: row.id,
    version: row.version,
    sessionId: row.session_id ?? undefined,
    kind: row.kind,
    title: row.title,
    createdAt: row.created_at,
  }
  const validation = validateArtifact(candidate)
  if (!validation.ok) {
    throw new CanvasPluginError(
      `Stored artifact "${row.id}@v${row.version}" failed schema validation. The table was modified out-of-band.`,
      { cause: validation.error },
    )
  }
  return validation.artifact
}

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/

export function createSqliteArtifactStore(
  options: CreateSqliteArtifactStoreOptions,
): ArtifactStore {
  const table = options.table ?? 'canvas_artifacts'
  if (!VALID_TABLE_NAME.test(table)) {
    throw new TypeError(`Invalid table name: "${table}". Must match ${VALID_TABLE_NAME}.`)
  }
  const { db } = options
  // `.bind(db)` is mandatory — better-sqlite3 exposes `exec` as a
  // prototype method that reads `this[Symbol(NativeDB)]` internally,
  // so extracting it without binding throws
  // "Cannot read properties of undefined (reading 'Symbol()')" on the
  // first call. Same caveat applies to any other Database method we
  // detach.
  const exec =
    typeof db.exec === 'function'
      ? db.exec.bind(db)
      : (sql: string) => {
          db.prepare(sql).run()
        }

  if (options.autoMigrate !== false) {
    migrate(exec, table)
  }

  return {
    insert: (artifact) => insertArtifact(db, table, artifact),
    get: (id, version) => getArtifact(db, table, id, version),
    getVersions: (id) => getArtifactVersions(db, table, id),
    list: (filter = {}) => listArtifacts(db, table, filter),
    nextVersion: (id) => queryNextVersion(db, table, id),
    delete: (id, version) => deleteArtifact(db, table, id, version),
  }
}

// ───── Extracted per-query functions ─────

function migrate(exec: (sql: string) => void, table: string): void {
  exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      session_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id, version)
    )
  `)
  exec(`CREATE INDEX IF NOT EXISTS idx_${table}_session ON ${table}(session_id, created_at DESC)`)
  exec(`CREATE INDEX IF NOT EXISTS idx_${table}_id ON ${table}(id, version)`)
}

// SQLite CRUD helpers: the store contract is Promise-based. Deferring
// the synchronous body through `Promise.resolve().then(...)` turns any
// synchronous throw (validation, driver error, not-found) into a
// rejected promise — the exact behavior the previous `async` functions
// had — while keeping the function non-`async` (satisfies require-await).
function insertArtifact(db: SqliteDb, table: string, artifact: Artifact): Promise<Artifact> {
  return Promise.resolve().then(() => {
    const validation = validateArtifact(artifact)
    if (!validation.ok) throw validation.error
    const a = validation.artifact
    const payload = JSON.stringify(stripEnvelope(a))
    try {
      db.prepare(
        `INSERT INTO ${table} (id, version, session_id, kind, title, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        a.id,
        a.version,
        a.sessionId ?? null,
        a.kind,
        a.title,
        payload,
        typeof a.createdAt === 'string' ? a.createdAt : new Date(a.createdAt).toISOString(),
      )
    } catch (err) {
      throw new CanvasPluginError(`Insert failed for artifact "${a.id}@v${a.version}".`, {
        cause: err,
      })
    }
    return a
  })
}

function getArtifact(
  db: SqliteDb,
  table: string,
  id: string,
  version?: number,
): Promise<Artifact | null> {
  return Promise.resolve().then(() => {
    const row =
      version === undefined
        ? db.prepare(`SELECT * FROM ${table} WHERE id = ? ORDER BY version DESC LIMIT 1`).get(id)
        : db.prepare(`SELECT * FROM ${table} WHERE id = ? AND version = ?`).get(id, version)
    if (row === undefined || row === null) return null
    return rowToArtifact(row as ArtifactRow)
  })
}

function getArtifactVersions(db: SqliteDb, table: string, id: string): Promise<Artifact[]> {
  return Promise.resolve().then(() => {
    const rows = db
      .prepare(`SELECT * FROM ${table} WHERE id = ? ORDER BY version ASC`)
      .all(id) as ArtifactRow[]
    return rows.map(rowToArtifact)
  })
}

function buildWhereClause(filter: ArtifactListFilter): { whereClause: string; params: unknown[] } {
  const params: unknown[] = []
  const where: string[] = []
  if (filter.sessionId !== undefined) {
    where.push('session_id = ?')
    params.push(filter.sessionId)
  }
  if (filter.kind !== undefined) {
    where.push('kind = ?')
    params.push(filter.kind)
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  return { whereClause, params }
}

function listArtifacts(
  db: SqliteDb,
  table: string,
  filter: ArtifactListFilter,
): Promise<Artifact[]> {
  return Promise.resolve().then(() => {
    const mode = filter.mode ?? 'latest'
    const offset = filter.offset ?? 0
    const limit = filter.limit ?? 200
    const { whereClause, params } = buildWhereClause(filter)
    const sql =
      mode === 'latest'
        ? `
          SELECT t.* FROM ${table} t
          INNER JOIN (
            SELECT id, MAX(version) AS max_version
            FROM ${table} ${whereClause}
            GROUP BY id
          ) m ON m.id = t.id AND m.max_version = t.version
          ORDER BY t.created_at DESC
          LIMIT ? OFFSET ?
        `
        : `
          SELECT * FROM ${table} ${whereClause}
          ORDER BY created_at DESC, version DESC
          LIMIT ? OFFSET ?
        `
    const rows = db.prepare(sql).all(...params, limit, offset) as ArtifactRow[]
    return rows.map(rowToArtifact)
  })
}

function queryNextVersion(db: SqliteDb, table: string, id: string): Promise<number> {
  return Promise.resolve().then(() => {
    const row = db.prepare(`SELECT MAX(version) AS max_v FROM ${table} WHERE id = ?`).get(id) as
      | { max_v: number | null }
      | undefined
    const max = row?.max_v ?? null
    return max === null ? 1 : max + 1
  })
}

function deleteArtifact(db: SqliteDb, table: string, id: string, version?: number): Promise<void> {
  return Promise.resolve().then(() => {
    const stmt =
      version === undefined
        ? db.prepare(`DELETE FROM ${table} WHERE id = ?`)
        : db.prepare(`DELETE FROM ${table} WHERE id = ? AND version = ?`)
    const result =
      version === undefined
        ? (stmt.run(id) as { changes?: number })
        : (stmt.run(id, version) as { changes?: number })
    if ((result.changes ?? 0) === 0) {
      throw new CanvasArtifactNotFoundError(version === undefined ? id : `${id}@v${version}`)
    }
  })
}

function stripEnvelope(a: Artifact): Record<string, unknown> {
  // Envelope fields live in dedicated columns; storing them again
  // inside `payload` would just bloat the row. We strip them on write
  // and re-attach on read (see `rowToArtifact`).
  const copy = { ...a } as Record<string, unknown>
  delete copy.id
  delete copy.version
  delete copy.sessionId
  delete copy.title
  delete copy.createdAt
  return copy
}
