/**
 * P#9 T4.1 — REAL multi-client presence sync via MemoryRealtimeProvider +
 * RealtimeRuntime end-to-end (no WS abstraction layer needed for this test;
 * the runtime is single-process and the provider fans frames synchronously,
 * so two simulated "clients" share the same runtime instance).
 *
 * This validates: client A updatePresence({cursor}) → within 100ms client B
 * receives presence-changed frame with the new cursor state.
 *
 * Mirrors the canonical Liveblocks multi-client presence test pattern
 * (`references/liveblocks/...`) adapted to in-process semantics. The real
 * WS roundtrip uses the same provider — adding the WS layer is a thin shim
 * (server-integration.ts).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRoom } from '../../src/define-room.js'
import { createMemoryRealtimeProvider } from '../../src/memory-provider.js'
import type { OutboundWireFrame } from '../../src/internal/runtime.js'
import { RealtimeRuntime } from '../../src/internal/runtime.js'

describe('P#9 multi-client presence sync (in-process)', () => {
  it('client A presence change reaches client B within 100ms', async () => {
    const provider = createMemoryRealtimeProvider()
    const room = defineRoom({
      id: 'cursor',
      presence: z.object({ x: z.number(), y: z.number() }).partial(),
      broadcast: z.object({ kind: z.literal('ping') }),
    })
    const rt = new RealtimeRuntime({ provider, rooms: [room] })

    const framesA: OutboundWireFrame[] = []
    const framesB: OutboundWireFrame[] = []

    // Alice joins first; her own listener gets her own join event.
    const handleA = await rt.handleConnection('cursor', { connectionId: 'alice' }, undefined, (f) =>
      framesA.push(f),
    )
    // Bob joins after; both listeners see Bob's join event.
    const handleB = await rt.handleConnection('cursor', { connectionId: 'bob' }, undefined, (f) =>
      framesB.push(f),
    )

    // Alice's listener should have seen both her own join AND Bob's join.
    const aliceSawJoins = framesA
      .filter((f) => f.type === 'joined')
      .map((f) => (f as { connectionId: string }).connectionId)
    expect(aliceSawJoins).toContain('alice')
    expect(aliceSawJoins).toContain('bob')
    // Bob's listener attached after alice joined; only sees his own (no replay).
    const bobSawJoins = framesB
      .filter((f) => f.type === 'joined')
      .map((f) => (f as { connectionId: string }).connectionId)
    expect(bobSawJoins).toContain('bob')
    // But Bob CAN see alice via getPresence snapshot.
    const presence = await rt.getPresence('cursor')
    expect(Object.keys(presence)).toEqual(expect.arrayContaining(['alice', 'bob']))

    const startNs = process.hrtime.bigint()
    await rt.dispatchFrame('cursor', 'alice', {
      kind: 'presence-update',
      patch: { x: 42, y: 24 },
    })
    const endNs = process.hrtime.bigint()
    const elapsedMs = Number(endNs - startNs) / 1_000_000

    expect(elapsedMs).toBeLessThan(100)

    const bChange = framesB.find(
      (f) =>
        f.type === 'presence-changed' && (f as { connectionId: string }).connectionId === 'alice',
    )
    expect(bChange).toBeDefined()
    expect((bChange as unknown as { presence: { x: number; y: number } }).presence).toEqual({
      x: 42,
      y: 24,
    })

    await handleA.release()
    await handleB.release()
  })

  it('broadcast from A reaches B (room-wide fanout)', async () => {
    const provider = createMemoryRealtimeProvider()
    const room = defineRoom({
      id: 'chat',
      presence: z.object({}),
      broadcast: z.object({ text: z.string() }),
    })
    const rt = new RealtimeRuntime({ provider, rooms: [room] })
    const framesB: OutboundWireFrame[] = []

    const handleA = await rt.handleConnection('chat', { connectionId: 'alice' }, undefined, () => {
      /* intentionally empty — alice is the sender; only bob's frames are asserted */
    })
    const handleB = await rt.handleConnection('chat', { connectionId: 'bob' }, undefined, (f) =>
      framesB.push(f),
    )

    await rt.dispatchFrame('chat', 'alice', {
      kind: 'broadcast',
      event: 'message',
      payload: { text: 'hello world' },
    })

    const bc = framesB.find((f) => f.type === 'broadcast')
    expect(bc).toBeDefined()
    expect((bc as unknown as { payload: { text: string } }).payload).toEqual({
      text: 'hello world',
    })

    await handleA.release()
    await handleB.release()
  })
})
