import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDrizzleMagicLinkStore } from '../fixtures/drizzle-adapter.js'

let sqlite: Database.Database
let store: ReturnType<typeof createDrizzleMagicLinkStore>

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE magic_link_tokens (
      token       TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      consumed_at INTEGER
    )
  `)
  store = createDrizzleMagicLinkStore(drizzle(sqlite))
})

afterEach(() => {
  sqlite.close()
})

describe('createOrmStore over a Drizzle database', () => {
  const future = () => new Date(Date.now() + 60_000)

  it('returns the email once, then null', async () => {
    await store.createToken({ email: 'a@example.com', token: 't1', expiresAt: future() })
    const first = await store.consumeToken({ token: 't1' })
    expect(first?.email).toBe('a@example.com')
    expect(await store.consumeToken({ token: 't1' })).toBeNull()
  })

  it('lets only one of two concurrent consumes win', async () => {
    await store.createToken({ email: 'a@example.com', token: 't2', expiresAt: future() })
    const results = await Promise.all([
      store.consumeToken({ token: 't2' }),
      store.consumeToken({ token: 't2' }),
    ])
    expect(results.filter((r) => r !== null)).toHaveLength(1)
  })

  it('cleanupExpired returns the number of rows removed', async () => {
    const past = new Date(Date.now() - 60_000)
    await store.createToken({ email: 'a@example.com', token: 'old1', expiresAt: past })
    await store.createToken({ email: 'b@example.com', token: 'old2', expiresAt: past })
    await store.createToken({ email: 'c@example.com', token: 'live', expiresAt: future() })
    expect(await store.cleanupExpired()).toBe(2)
    expect(await store.cleanupExpired()).toBe(0)
    expect((await store.consumeToken({ token: 'live' }))?.email).toBe('c@example.com')
  })
})
