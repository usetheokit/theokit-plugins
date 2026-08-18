/**
 * `createSqliteArtifactStore` against a real SQLite database, held to the same contract as
 * its in-memory sibling.
 *
 * The store's existing coverage is five cases, all of them table-name validation, all
 * against `{} as db` — an empty object cast to the driver type. So no SQL was ever
 * executed: `autoMigrate` never ran, and insert / get / getVersions / list / nextVersion /
 * delete were unverified against a database. The package ships a SQLite store and had
 * never run one.
 *
 * That is the same shape as two defects already found in this repo — CLI arguments blessed
 * by our own expectation instead of the tool's grammar (#48), and a store's atomicity
 * proven against a Map that cannot fail the way SQL can. A fake agrees with whoever wrote
 * it; only the engine disagrees.
 *
 * The strategy here is conformance rather than a second set of hand-written expectations:
 * every case runs the SAME sequence through both stores and asserts they observe the same
 * thing. That makes the in-memory store the executable specification it already is in
 * practice, and any divergence a defect in one of the two rather than a difference of
 * opinion between two test files.
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createInMemoryArtifactStore,
  createSqliteArtifactStore,
  type ArtifactStore,
} from '../../src/index.js'
import type { Artifact } from '../../src/schema.js'

let db: Database.Database
let sqlite: ArtifactStore
let memory: ArtifactStore

beforeEach(() => {
  db = new Database(':memory:')
  // autoMigrate defaults to true and had never been executed by any test; letting it run
  // is itself an assertion — a broken CREATE TABLE would throw here.
  sqlite = createSqliteArtifactStore({ db })
  memory = createInMemoryArtifactStore()
})

afterEach(() => {
  db.close()
})

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a1',
    title: 'Notes',
    createdAt: '2026-05-29T00:00:00Z',
    version: 1,
    kind: 'markdown',
    content: '# hello',
    ...overrides,
  } as Artifact
}

/**
 * `Artifact` is a discriminated union on `kind`, and only some members carry `content`.
 * Narrowing here rather than casting keeps the assertion honest: if a fixture's kind ever
 * changes, this throws instead of silently reading `undefined`.
 */
function markdownContent(a: Artifact | null): string {
  if (a === null) throw new Error('expected an artifact, got null')
  if (a.kind !== 'markdown') throw new Error(`expected a markdown artifact, got ${a.kind}`)
  return a.content
}

/** Run one operation through both stores and require them to agree. */
async function both<T>(op: (store: ArtifactStore) => Promise<T>): Promise<T> {
  const fromMemory = await op(memory)
  const fromSqlite = await op(sqlite)
  expect(fromSqlite, 'the sqlite store diverged from the in-memory contract').toEqual(fromMemory)
  return fromSqlite
}

describe('the sqlite store obeys the same contract as the in-memory one', () => {
  it('round-trips an artifact through real SQL', async () => {
    await both((s) => s.insert(artifact()))

    expect(markdownContent(await both((s) => s.get('a1')))).toBe('# hello')

    // Read the table directly: `toEqual` between two stores would pass if BOTH were
    // broken in the same way, and only the column proves something was persisted.
    const rows = db.prepare('SELECT id, version FROM canvas_artifacts').all()
    expect(rows).toEqual([{ id: 'a1', version: 1 }])
  })

  it('returns null for an unknown id, and for a version that does not exist', async () => {
    await both((s) => s.insert(artifact()))

    expect(await both((s) => s.get('nope'))).toBeNull()
    expect(await both((s) => s.get('a1', 99))).toBeNull()
  })

  it('versions accumulate and `nextVersion` counts them the same way', async () => {
    await both((s) => s.insert(artifact({ version: 1, content: 'v1' })))
    await both((s) => s.insert(artifact({ version: 2, content: 'v2' })))

    expect(await both((s) => s.nextVersion('a1'))).toBe(3)
    // A fresh id starts at 1 in both — the boundary where an off-by-one would hide.
    expect(await both((s) => s.nextVersion('never-seen'))).toBe(1)

    const versions = await both((s) => s.getVersions('a1'))
    expect(versions.map(markdownContent)).toEqual(['v1', 'v2'])
  })

  it('`get` with no version returns the latest, not the first inserted', async () => {
    await both((s) => s.insert(artifact({ version: 1, content: 'old' })))
    await both((s) => s.insert(artifact({ version: 2, content: 'new' })))

    // The assertion an ORDER BY typo breaks, and which no in-memory-only test can catch
    // for the SQL path.
    expect(markdownContent(await both((s) => s.get('a1')))).toBe('new')
  })

  it('deleting one version leaves the others; deleting all removes the artifact', async () => {
    await both((s) => s.insert(artifact({ version: 1 })))
    await both((s) => s.insert(artifact({ version: 2 })))

    await both((s) => s.delete('a1', 1))
    expect((await both((s) => s.getVersions('a1'))).map((a) => a.version)).toEqual([2])

    await both((s) => s.delete('a1'))
    expect(await both((s) => s.getVersions('a1'))).toEqual([])
    expect(await both((s) => s.get('a1'))).toBeNull()
  })

  it('lists across ids, and both stores agree on the order', async () => {
    await both((s) => s.insert(artifact({ id: 'a1', title: 'first' })))
    await both((s) => s.insert(artifact({ id: 'a2', title: 'second' })))

    const listed = await both((s) => s.list())
    expect(listed.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })

  it('every artifact kind survives the SQL round trip', async () => {
    // Each kind carries a DIFFERENT content field — `content` for markdown/code/svg/
    // mermaid, `srcdoc` for html — so a column that serialises one shape correctly can
    // still lose another. Enumerated rather than sampled, and each fixture is built to its
    // own schema rather than to a shared guess.
    const kinds: { artifact: Artifact; read: (a: Artifact) => unknown }[] = [
      {
        artifact: artifact({ id: 'k-md', kind: 'markdown', content: '# md' }),
        read: (a) => (a as { content: string }).content,
      },
      {
        artifact: artifact({
          id: 'k-code',
          kind: 'code',
          language: 'ts',
          content: 'const a = 1',
        }),
        read: (a) => (a as { content: string }).content,
      },
      {
        artifact: artifact({
          id: 'k-svg',
          kind: 'svg',
          content: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        }),
        read: (a) => (a as { content: string }).content,
      },
      {
        artifact: artifact({ id: 'k-mermaid', kind: 'mermaid', content: 'graph TD; a-->b' }),
        read: (a) => (a as { content: string }).content,
      },
      {
        artifact: artifact({
          id: 'k-html',
          kind: 'html',
          srcdoc: '<p>hi</p>',
          sandbox: 'minimal',
        }),
        read: (a) => (a as { srcdoc: string }).srcdoc,
      },
    ]

    for (const { artifact: a, read } of kinds) {
      await sqlite.insert(a)
      const back = await sqlite.get(a.id)
      expect(back, `${a.kind} did not come back`).not.toBeNull()
      expect(back?.kind, `${a.kind} changed kind through SQL`).toBe(a.kind)
      expect(back === null ? null : read(back), `${a.kind} lost its payload`).toBe(read(a))
    }
  })

  it('a row corrupted out-of-band is refused instead of being handed back', async () => {
    await sqlite.insert(artifact())

    // The store validates what it reads, and says so in its own error message: "The table
    // was modified out-of-band." That path had no test, and it is the one that decides
    // whether a bad row becomes a crash at the boundary or a malformed artifact deep in
    // the UI — `rules/error-handling.md` § 2 wants the former.
    db.prepare("UPDATE canvas_artifacts SET kind = 'not-a-kind' WHERE id = 'a1'").run()

    await expect(sqlite.get('a1')).rejects.toThrow(/out-of-band|validation/i)
  })

  it('a custom table name is honoured, not silently ignored', async () => {
    const store = createSqliteArtifactStore({ db, table: 'my_artifacts' })
    await store.insert(artifact({ id: 'custom' }))

    // The five pre-existing cases proved a bad table name is REJECTED. None proved a good
    // one is used — which is the half that matters for anyone who sets it.
    const rows = db.prepare('SELECT id FROM my_artifacts').all()
    expect(rows).toEqual([{ id: 'custom' }])
  })
})
