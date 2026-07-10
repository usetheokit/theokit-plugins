import { describe, expect, it } from 'vitest'
import { createYjsRealtimeProvider } from '../src/yjs-provider.js'
import { RealtimeError } from '../src/types.js'

describe('YjsRealtimeProvider (peer present)', () => {
  it('joinRoom + getPresence reads from Awareness states', async () => {
    const p = createYjsRealtimeProvider()
    await p.joinRoom('room', { connectionId: 'c1' }, { name: 'alice' })
    const snap = await p.getPresence('room')
    expect(snap.c1).toEqual({ name: 'alice' })
  })

  it('updatePresence merges via Awareness', async () => {
    const p = createYjsRealtimeProvider()
    await p.joinRoom('room', { connectionId: 'c1' }, { name: 'alice' })
    await p.updatePresence('room', 'c1', { cursor: [1, 2] })
    const snap = await p.getPresence('room')
    expect(snap.c1).toEqual({ name: 'alice', cursor: [1, 2] })
  })

  it('broadcast fanout same as memory', async () => {
    const p = createYjsRealtimeProvider()
    const events: unknown[] = []
    p.subscribeRoom('room', (f) => events.push(f))
    // Wait one tick for lazy ensureRoom subscribe path.
    await new Promise((r) => setTimeout(r, 5))
    await p.joinRoom('room', { connectionId: 'c1' })
    await p.broadcast('room', 'c1', 'ping', { ts: 1 })
    const broadcasts = events.filter((e) => (e as { type: string }).type === 'broadcast')
    expect(broadcasts).toHaveLength(1)
  })

  it('applyYjsUpdate rejects oversized updates', async () => {
    const p = createYjsRealtimeProvider({ maxUpdateBytes: 10 })
    await p.joinRoom('room', { connectionId: 'c1' })
    await expect(p.applyYjsUpdate?.('room', 'c1', new Uint8Array(11))).rejects.toThrow(
      RealtimeError,
    )
  })

  it('applyYjsAwareness rejects oversized updates', async () => {
    const p = createYjsRealtimeProvider({ maxUpdateBytes: 10 })
    await p.joinRoom('room', { connectionId: 'c1' })
    await expect(p.applyYjsAwareness?.('room', 'c1', new Uint8Array(11))).rejects.toThrow(
      RealtimeError,
    )
  })

  it('multi-room isolation: separate Y.Doc instances', async () => {
    const p = createYjsRealtimeProvider()
    await p.joinRoom('A', { connectionId: 'ca' }, { name: 'alice' })
    await p.joinRoom('B', { connectionId: 'cb' }, { name: 'bob' })
    expect(await p.getPresence('A')).toEqual({ ca: { name: 'alice' } })
    expect(await p.getPresence('B')).toEqual({ cb: { name: 'bob' } })
  })

  it('leaveRoom clears connection-to-clientId mapping', async () => {
    const p = createYjsRealtimeProvider()
    await p.joinRoom('room', { connectionId: 'c1' }, { name: 'alice' })
    await p.leaveRoom('room', 'c1')
    // Room is GC'd when no connections + no listeners — getPresence returns {}.
    const snap = await p.getPresence('room')
    expect(snap).toEqual({})
  })
})
