/**
 * RED tests for P#6 T2.3 — IdempotencyStore
 *
 * Per plan p6-plugin-payments v1.0 § Phase 2 / T2.3.
 * Blueprint ADR D2 — idempotency is canonical gap; plugin SHALL ship it.
 */
import { describe, expect, it } from 'vitest'

import {
  createMemoryStore,
  createOrmStore,
  type IdempotencyRepository,
} from '../src/idempotency-store.js'

describe('createMemoryStore (P#6 T2.3)', () => {
  it('returns true on first markProcessed call for a new event ID', async () => {
    const store = createMemoryStore()
    const result = await store.markProcessed('evt_new_001')
    expect(result).toBe(true)
  })

  it('returns false on subsequent markProcessed calls for same event ID', async () => {
    const store = createMemoryStore()
    await store.markProcessed('evt_dup_001')
    const result = await store.markProcessed('evt_dup_001')
    expect(result).toBe(false)
  })

  it('handles concurrent markProcessed calls atomically (exactly one wins)', async () => {
    const store = createMemoryStore()
    const eventId = 'evt_concurrent_001'

    // Fire 5 concurrent calls for the same event ID
    const results = await Promise.all([
      store.markProcessed(eventId),
      store.markProcessed(eventId),
      store.markProcessed(eventId),
      store.markProcessed(eventId),
      store.markProcessed(eventId),
    ])

    // Then: exactly one returned true; the rest returned false
    const wins = results.filter((r) => r === true)
    expect(wins).toHaveLength(1)
  })

  it('isolates event IDs (different IDs each return true on first call)', async () => {
    const store = createMemoryStore()
    expect(await store.markProcessed('evt_a')).toBe(true)
    expect(await store.markProcessed('evt_b')).toBe(true)
    expect(await store.markProcessed('evt_c')).toBe(true)
  })

  // T2.2 (#167) — release() un-claims an event so a retry can re-run it after
  // a handler failure (exactly-once on success, retry-on-failure).
  it('release() lets a claimed event be re-claimed (retry after failure)', async () => {
    const store = createMemoryStore()
    expect(await store.markProcessed('evt_rel')).toBe(true)
    expect(await store.markProcessed('evt_rel')).toBe(false) // already claimed
    await store.release('evt_rel')
    expect(await store.markProcessed('evt_rel')).toBe(true) // re-claimable after release
  })

  it('release() of an unknown event id is a no-op (no throw)', async () => {
    const store = createMemoryStore()
    await expect(store.release('evt_never_claimed')).resolves.toBeUndefined()
  })
})

describe('createOrmStore (P#6 T2.3)', () => {
  it('delegates to repo.insertNew and propagates the result', async () => {
    // Given: a mock repository that returns true for the first call
    let callCount = 0
    const mockRepo: IdempotencyRepository = {
      insertNew(eventId: string) {
        callCount += 1
        return Promise.resolve(eventId === 'evt_new' && callCount === 1)
      },
      delete: () => Promise.resolve(),
    }
    const store = createOrmStore(mockRepo)

    // Then: store mirrors repo behavior
    expect(await store.markProcessed('evt_new')).toBe(true)
    expect(await store.markProcessed('evt_new')).toBe(false)
  })

  it('repo throwing propagates to the caller (does not swallow)', async () => {
    const mockRepo: IdempotencyRepository = {
      insertNew() {
        return Promise.reject(new Error('DB connection lost'))
      },
      delete: () => Promise.resolve(),
    }
    const store = createOrmStore(mockRepo)
    await expect(store.markProcessed('evt_x')).rejects.toThrow('DB connection lost')
  })

  it('release() delegates to repo.delete (T2.2 #167)', async () => {
    const deleted: string[] = []
    const mockRepo: IdempotencyRepository = {
      insertNew() {
        return Promise.resolve(true)
      },
      delete(eventId: string) {
        deleted.push(eventId)
        return Promise.resolve()
      },
    }
    const store = createOrmStore(mockRepo)
    await store.release('evt_y')
    expect(deleted).toEqual(['evt_y'])
  })
})
