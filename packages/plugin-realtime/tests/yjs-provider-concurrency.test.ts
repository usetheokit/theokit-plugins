/**
 * #193 — ensureYjs check-then-act race (T4.1).
 *
 * NOTE on the test vector: the plan sketched the RED as concurrent `joinRoom`,
 * but `joinRoom` never calls `ensureYjs` (it only sets presence) — so concurrent
 * `joinRoom` creates ZERO Y.Docs and cannot reproduce #193. The race is reachable
 * ONLY via the methods that call `ensureYjs`: `applyYjsUpdate` / `applyYjsAwareness`.
 * This file exercises the real vector. (Deviation logged in the implementation log.)
 *
 * The provider does not expose the Y.Doc, so we mock the `yjs` + `y-protocols`
 * modules to count Doc constructions — the observable proof that exactly one doc
 * is shared across concurrent applies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  docCtorCount: 0,
  destroyCount: 0,
  throwOnNextDocCtor: false,
  appliedOnDestroyed: false,
}))

vi.mock('yjs', () => {
  class FakeDoc {
    readonly clientID = 1
    destroyed = false
    constructor() {
      if (h.throwOnNextDocCtor) {
        h.throwOnNextDocCtor = false
        throw new Error('simulated Y.Doc init failure (EC-1)')
      }
      h.docCtorCount += 1
    }
    destroy(): void {
      this.destroyed = true
      h.destroyCount += 1
    }
  }
  return {
    Doc: FakeDoc,
    // Mirrors real Yjs: applying to a destroyed doc is the #194 hazard. Record it
    // so the test can assert no apply ever lands on a destroyed/GC'd doc.
    applyUpdate: (doc: { destroyed?: boolean }) => {
      if (doc?.destroyed) h.appliedOnDestroyed = true
    },
  }
})

vi.mock('y-protocols/awareness.js', () => {
  class FakeAwareness {
    readonly clientID = 1
    readonly states = new Map<number, Record<string, unknown>>()
    constructor(readonly doc: { destroyed?: boolean }) {}
    getStates(): Map<number, Record<string, unknown>> {
      return this.states
    }
    setLocalState(): void {
      /* noop fake */
    }
    destroy(): void {
      /* noop fake */
    }
  }
  return {
    Awareness: FakeAwareness,
    applyAwarenessUpdate: (aw: { doc?: { destroyed?: boolean } }) => {
      if (aw?.doc?.destroyed) h.appliedOnDestroyed = true
    },
  }
})

import { createYjsRealtimeProvider } from '../src/yjs-provider.js'

describe('YjsRealtimeProvider — concurrency (#193)', () => {
  beforeEach(() => {
    h.docCtorCount = 0
    h.destroyCount = 0
    h.throwOnNextDocCtor = false
    h.appliedOnDestroyed = false
  })

  it('test_concurrent_apply_shares_single_ydoc', async () => {
    const p = createYjsRealtimeProvider()
    await p.joinRoom('room', { connectionId: 'c1' })

    // Barrier: two concurrent applies on the SAME fresh room. The check-then-act
    // race (null-check, then `await loadYjs()`, then `new Doc`) would let both
    // callers construct a Doc, orphaning the first. The single-flight memo must
    // ensure exactly ONE Doc is created.
    await Promise.all([
      p.applyYjsUpdate!('room', 'c1', new Uint8Array([1])),
      p.applyYjsUpdate!('room', 'c2', new Uint8Array([2])),
    ])

    expect(h.docCtorCount).toBe(1)
  })

  it('test_failed_doc_init_clears_memo_and_allows_retry', async () => {
    // EC-1: if doc init rejects, the per-room memo must be cleared so a later
    // apply can recreate the doc — no permanently bricked room.
    const p = createYjsRealtimeProvider()
    await p.joinRoom('room', { connectionId: 'c1' })

    h.throwOnNextDocCtor = true
    await expect(p.applyYjsUpdate!('room', 'c1', new Uint8Array([1]))).rejects.toThrow()

    // Retry: the memo was cleared on failure, so this recreates successfully.
    await p.applyYjsUpdate!('room', 'c1', new Uint8Array([2]))
    expect(h.docCtorCount).toBe(1)
  })
})

describe("YjsRealtimeProvider — destroyed/GC'd doc guard (#194)", () => {
  beforeEach(() => {
    h.docCtorCount = 0
    h.destroyCount = 0
    h.throwOnNextDocCtor = false
    h.appliedOnDestroyed = false
  })

  it('test_apply_after_gc_is_safe_noop', async () => {
    // A doc resolved by a first apply; then a SECOND apply races a leaveRoom that
    // would GC (destroy) the doc. The in-flight op must keep the doc alive (or
    // skip cleanly) — it must NEVER call applyUpdate on a destroyed doc.
    const p = createYjsRealtimeProvider()
    await p.joinRoom('room', { connectionId: 'c1' })
    await p.applyYjsUpdate!('room', 'c1', new Uint8Array([1])) // resolve the doc

    const op = p.applyYjsUpdate!('room', 'c1', new Uint8Array([2])) // in-flight
    await p.leaveRoom('room', 'c1') // GC attempt while op is awaiting ensureYjs
    await expect(op).resolves.toBeUndefined()

    expect(h.appliedOnDestroyed).toBe(false)
  })

  it('test_no_orphan_when_room_gcd_during_doc_init', async () => {
    // The T4.1-deferred orphan: leaveRoom runs while doc init is in flight
    // (resolved still undefined). Without the in-flight guard, gcIfEmpty deletes
    // the room but skips destroy (no resolved doc yet), then init completes and
    // leaks a Y.Doc on a deleted room. Every created doc MUST be destroyed.
    const p = createYjsRealtimeProvider()
    await p.joinRoom('room', { connectionId: 'c1' })

    const op = p.applyYjsUpdate!('room', 'c1', new Uint8Array([1])) // triggers init
    await p.leaveRoom('room', 'c1') // GC during in-flight init
    await op

    expect(h.docCtorCount).toBeGreaterThan(0)
    expect(h.destroyCount).toBe(h.docCtorCount) // no orphan
  })
})
