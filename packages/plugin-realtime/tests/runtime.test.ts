import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRoom } from '../src/define-room.js'
import { createMemoryRealtimeProvider } from '../src/memory-provider.js'
import {
  RealtimeAuthorizationError,
  RealtimePresenceError,
  RealtimeRoomNotFoundError,
} from '../src/types.js'
import { RealtimeRuntime } from '../src/internal/runtime.js'

const cursorRoom = defineRoom({
  id: 'cursor',
  presence: z.object({ x: z.number(), y: z.number() }).partial(),
  broadcast: z.object({ kind: z.literal('ping'), ts: z.number() }),
})

describe('RealtimeRuntime', () => {
  it('registerRoom + getRoom', () => {
    const provider = createMemoryRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [cursorRoom] })
    expect(rt.getRoom('cursor')?.id).toBe('cursor')
  })

  it('handleConnection joins + fans frames', async () => {
    const provider = createMemoryRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [cursorRoom] })
    const frames: unknown[] = []
    const handle = await rt.handleConnection(
      'cursor',
      { connectionId: 'c1' },
      { x: 1, y: 2 },
      (f) => frames.push(f),
    )
    expect(frames).toHaveLength(1)
    expect((frames[0] as { type: string }).type).toBe('joined')
    await handle.release()
  })

  it('authorize rejection throws RealtimeAuthorizationError', async () => {
    const provider = createMemoryRealtimeProvider()
    const room = defineRoom({
      id: 'private',
      presence: z.object({}),
      broadcast: z.object({}),
      authorize: () => false,
    })
    const rt = new RealtimeRuntime({ provider, rooms: [room] })
    await expect(
      rt.handleConnection('private', { connectionId: 'c1' }, undefined, () => {
        /* intentionally empty — this connection is rejected before any frame */
      }),
    ).rejects.toThrow(RealtimeAuthorizationError)
  })

  it('invalid initial presence throws RealtimePresenceError', async () => {
    const provider = createMemoryRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [cursorRoom] })
    await expect(
      rt.handleConnection('cursor', { connectionId: 'c1' }, { x: 'not a number' }, () => {
        /* intentionally empty — this connection is rejected before any frame */
      }),
    ).rejects.toThrow(RealtimePresenceError)
  })

  it('dispatchFrame presence-update validates + delegates', async () => {
    const provider = createMemoryRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [cursorRoom] })
    await rt.handleConnection('cursor', { connectionId: 'c1' }, undefined, () => {
      /* intentionally empty — this test asserts on getPresence, not on frames */
    })
    await rt.dispatchFrame('cursor', 'c1', { kind: 'presence-update', patch: { x: 5 } })
    const presence = await rt.getPresence('cursor')
    expect(presence.c1?.x).toBe(5)
  })

  it('dispatchFrame broadcast validates + delegates', async () => {
    const provider = createMemoryRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [cursorRoom] })
    const frames: unknown[] = []
    await rt.handleConnection('cursor', { connectionId: 'c1' }, undefined, (f) => frames.push(f))
    await rt.dispatchFrame('cursor', 'c1', {
      kind: 'broadcast',
      event: 'ping',
      payload: { kind: 'ping', ts: 999 },
    })
    const bc = frames.find((f) => (f as { type: string }).type === 'broadcast')
    expect(bc).toBeDefined()
  })

  it('unknown room throws RealtimeRoomNotFoundError', async () => {
    const provider = createMemoryRealtimeProvider()
    const rt = new RealtimeRuntime({ provider })
    await expect(
      rt.handleConnection('nope', { connectionId: 'c1' }, undefined, () => {
        /* intentionally empty — this connection is rejected before any frame */
      }),
    ).rejects.toThrow(RealtimeRoomNotFoundError)
  })

  it('yjs-update on a room that never declared storage:"yjs" is refused, not dropped', async () => {
    // B-011. This test used to be named "…is a no-op" and asserted `resolves.toBeUndefined()` —
    // it PINNED the silent drop as intended behaviour. It was the only thing standing behind a
    // swallow that `rules/error-handling.md § 2` forbids, and it made the drop look deliberate.
    //
    // A no-op is the right shape for a frame the system has no opinion about. A CRDT frame sent to
    // a room whose descriptor never declared CRDT storage is not that: either the client is wrong
    // about the room or the room is missing a declaration, and both are worth saying out loud.
    const provider = createMemoryRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [cursorRoom] })
    await rt.handleConnection('cursor', { connectionId: 'c1' }, undefined, () => {
      /* intentionally empty — this test asserts the refusal, not frames */
    })
    await expect(
      rt.dispatchFrame('cursor', 'c1', { kind: 'yjs-update', bytes: new Uint8Array(0) }),
    ).rejects.toThrow(/does not declare storage/i)
  })

  it('test_yjs_room_without_provider_support_errors', async () => {
    // #197: a room that declares storage:"yjs" but is wired to a provider with
    // no applyYjsUpdate must FAIL LOUDLY (Rule 8) — silently dropping the frame
    // hides the misconfiguration and loses CRDT state.
    const provider = createMemoryRealtimeProvider() // no applyYjsUpdate
    const yjsRoom = defineRoom({
      id: 'doc',
      presence: z.object({}).partial(),
      broadcast: z.object({ kind: z.literal('x') }),
      storage: 'yjs',
    })
    const rt = new RealtimeRuntime({ provider, rooms: [yjsRoom] })
    await rt.handleConnection('doc', { connectionId: 'c1' }, undefined, () => {
      /* frames ignored */
    })

    await expect(
      rt.dispatchFrame('doc', 'c1', { kind: 'yjs-update', bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toMatchObject({ code: 'yjs_provider_unsupported' })
    await expect(
      rt.dispatchFrame('doc', 'c1', { kind: 'yjs-awareness', bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toMatchObject({ code: 'yjs_provider_unsupported' })
  })
})
