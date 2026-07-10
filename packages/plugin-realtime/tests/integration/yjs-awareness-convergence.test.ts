/**
 * P#9 T4.2 — REAL Yjs Awareness convergence via YjsRealtimeProvider.
 *
 * Two connections in the same room update simultaneously; both converge to a
 * merged state via Y-Awareness clock-vector semantics (per y-protocols).
 *
 * Mirrors `references/y-protocols/src/awareness.test.js` canonical pattern.
 */
import { describe, expect, it } from 'vitest'
import { createYjsRealtimeProvider } from '../../src/yjs-provider.js'

describe('P#9 Yjs Awareness convergence (in-process)', () => {
  it('two clients update simultaneously and converge', async () => {
    const provider = createYjsRealtimeProvider()
    await provider.joinRoom('room', { connectionId: 'alice' }, { name: 'alice' })
    await provider.joinRoom('room', { connectionId: 'bob' }, { name: 'bob' })

    // Simulate simultaneous updates: alice sets cursor, bob sets cursor.
    await Promise.all([
      provider.updatePresence('room', 'alice', { cursor: [10, 20] }),
      provider.updatePresence('room', 'bob', { cursor: [30, 40] }),
    ])

    const snap = await provider.getPresence('room')
    expect(snap.alice).toEqual({ name: 'alice', cursor: [10, 20] })
    expect(snap.bob).toEqual({ name: 'bob', cursor: [30, 40] })
  })

  it('local Y-Awareness clientID drives setLocalState branch', async () => {
    const provider = createYjsRealtimeProvider()
    await provider.joinRoom('room', { connectionId: 'self' }, { name: 'self' })
    // Local Awareness clientID is mapped to the first connectionId via joinRoom.
    // After joinRoom + updatePresence, the snapshot reflects merged state.
    await provider.updatePresence('room', 'self', { mode: 'edit' })
    const snap = await provider.getPresence('room')
    expect(snap.self).toMatchObject({ name: 'self', mode: 'edit' })
  })

  it('subscribeRoom listeners receive presence-changed frames', async () => {
    const provider = createYjsRealtimeProvider()
    const frames: unknown[] = []
    provider.subscribeRoom('room', (f) => frames.push(f))
    // Wait for lazy ensureRoom subscribe path.
    await new Promise((r) => setTimeout(r, 5))
    await provider.joinRoom('room', { connectionId: 'alice' }, { name: 'alice' })
    await provider.updatePresence('room', 'alice', { cursor: [1, 2] })
    const changed = frames.find((f) => (f as { type: string }).type === 'presence-changed')
    expect(changed).toBeDefined()
  })
})
