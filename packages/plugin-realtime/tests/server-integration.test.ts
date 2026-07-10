/**
 * #195 / #198 — server-integration abort handling + bounded queue (T4.3).
 *
 * The mounted subscription handler is a G8 async generator driven by an
 * AbortSignal. Two HIGH defects:
 *   #195 — the abort listener was registered AFTER `await handleConnection`, so
 *          an abort during that await was missed: the generator blocked forever
 *          on its waiter, leaking the connection handle + listener. The frame
 *          queue was also unbounded (a slow/absent consumer = memory DoS).
 *   #198 — `onFrame` enqueued frames even after abort (stopped), amplifying the
 *          unbounded-queue growth.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineRoom } from '../src/define-room.js'
import { createMemoryRealtimeProvider } from '../src/memory-provider.js'
import { RealtimeRuntime } from '../src/internal/runtime.js'
import { mountRealtime, type MountedSubscriptionCtx } from '../src/internal/server-integration.js'

function makeCtx(
  signal: AbortSignal,
  connectionId: string,
  disconnect: (code?: number, reason?: string) => void = () => {
    /* noop default */
  },
): MountedSubscriptionCtx {
  return {
    signal,
    connectionId,
    disconnect,
    tracked: <T>(id: string, payload: T) => [id, payload] as const,
  }
}

describe('mountRealtime handler — abort + bounded queue (#195, #198)', () => {
  it('test_abort_releases_connection_handle', async () => {
    // Force the abort to land DURING `await handleConnection` via an authorize
    // gate we control. The handler must observe it and exit (release the handle),
    // not block forever yielding the buffered 'joined' frame.
    let openGate!: () => void
    const gate = new Promise<void>((r) => {
      openGate = r
    })
    const provider = createMemoryRealtimeProvider()
    const room = defineRoom({
      id: 'r',
      presence: z.object({}).partial(),
      broadcast: z.object({ kind: z.literal('ping') }),
      authorize: async () => {
        await gate
        return true
      },
    })
    const rt = new RealtimeRuntime({ provider, rooms: [room] })
    const { handler } = mountRealtime({ runtime: rt, rooms: [room] }).subscriptions.get('r')!

    const controller = new AbortController()
    const gen = handler({}, makeCtx(controller.signal, 'c1'))
    const first = gen.next() // runs into authorize's `await gate` (handleConnection in flight)
    controller.abort() // #195: abort DURING the handleConnection await
    openGate() // let handleConnection resolve

    const r = await first
    expect(r.done).toBe(true) // generator exits on abort instead of yielding 'joined'
    expect(await provider.getPresence('r')).toEqual({}) // handle released → left the room
  })

  it('test_queue_is_bounded_under_flood', async () => {
    const provider = createMemoryRealtimeProvider()
    const room = defineRoom({
      id: 'r',
      presence: z.object({}).partial(),
      broadcast: z.object({ kind: z.literal('ping'), n: z.number() }),
    })
    const rt = new RealtimeRuntime({ provider, rooms: [room] })
    const { handler } = mountRealtime({ runtime: rt, rooms: [room] }).subscriptions.get('r')!

    const controller = new AbortController()
    const disconnect = vi.fn()
    const ctx = makeCtx(controller.signal, 'c1', disconnect)
    const gen = handler({}, ctx)
    await gen.next() // 'joined' yielded; generator now suspended (NOT consuming)

    // Flood frames the suspended consumer never drains → the queue must be bounded
    // and overflow must disconnect the connection (rather than grow unbounded).
    for (let i = 0; i < 4096; i++) {
      await provider.broadcast('r', 'flooder', 'ping', { kind: 'ping', n: i })
    }

    expect(disconnect).toHaveBeenCalled()
  })

  it('test_onframe_stops_after_abort', async () => {
    // #198 regression guard: after abort, onFrame must DROP frames (not enqueue),
    // so a post-abort flood never reaches the cap / triggers disconnect. (Not a
    // RED against the pre-fix baseline — it guards the stopped-check from being
    // removed once the cap exists.)
    const provider = createMemoryRealtimeProvider()
    const room = defineRoom({
      id: 'r',
      presence: z.object({}).partial(),
      broadcast: z.object({ kind: z.literal('ping'), n: z.number() }),
    })
    const rt = new RealtimeRuntime({ provider, rooms: [room] })
    const { handler } = mountRealtime({ runtime: rt, rooms: [room] }).subscriptions.get('r')!

    const controller = new AbortController()
    const disconnect = vi.fn()
    const ctx = makeCtx(controller.signal, 'c1', disconnect)
    const gen = handler({}, ctx)
    await gen.next() // 'joined'; suspended at yield
    controller.abort() // stopped = true

    for (let i = 0; i < 4096; i++) {
      await provider.broadcast('r', 'flooder', 'ping', { kind: 'ping', n: i })
    }

    expect(disconnect).not.toHaveBeenCalled() // post-abort frames dropped, no overflow
    const r = await gen.next()
    expect(r.done).toBe(true)
  })
})
