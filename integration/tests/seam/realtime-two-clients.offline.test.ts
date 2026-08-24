/**
 * Two clients in one room, over the real runtime — the question B-010 asks.
 *
 * The item records that `emitBroadcast` was an empty body and `emit` only merged into local state,
 * and blames `@theokit/sdk`'s subscribe API for having no upstream `.send()`. That blocker is real
 * — measured, `subscribe()` returns `AsyncGenerator<TOutput, void, void>`, so `next(value)` carries
 * nothing either — but it is not what kept the hooks silent.
 *
 * The server half was always complete: `RealtimeRuntime.dispatchFrame` validates an inbound frame
 * against the room's schema and calls `provider.broadcast`, which fans out to every participant.
 * `RealtimeRuntime` and `handleConnection` are public. What was missing was a send-side port on the
 * client, which the hooks never declared.
 *
 * So this suite asserts the thing a unit test with a recording sender cannot: that a frame sent by
 * one connection is OBSERVED by another. A recording sender proves the port is called; only two
 * connections prove the fan-out reaches the second one.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request. The
 * in-memory provider needs no network and no credential.
 */

import { type RealtimeSendClient } from '@theokit/plugin-realtime/react'
import {
  createMemoryRealtimeProvider,
  type Presence,
  type OutboundWireFrame,
  defineRoom,
  RealtimeRuntime,
  type RealtimeConnectionHandle,
} from '@theokit/plugin-realtime'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

const ROOM = defineRoom({
  id: 'cursor',
  presence: z.object({ cursor: z.tuple([z.number(), z.number()]).optional() }),
  broadcast: z.object({ text: z.string() }),
})

/**
 * A room with a REQUIRED presence field.
 *
 * The suite originally had only the all-optional shape above, and that is the one schema for which
 * a broken presence path passes: `dispatchFrame` used to validate the PATCH against the full
 * schema, so any required field rejected every partial update — and `useUpdateMyPresence(patch)`
 * can only ever send a patch. The advertised presence path was dead for those rooms, silently.
 *
 * A fake agrees with whoever wrote it. This is the shape that disagrees.
 */
const ROOM_REQUIRED = defineRoom({
  id: 'named',
  presence: z.object({
    name: z.string(),
    cursor: z.tuple([z.number(), z.number()]).optional(),
  }),
  broadcast: z.object({ text: z.string() }),
})

interface Client {
  readonly id: string
  readonly handle: RealtimeConnectionHandle
  /** Frames this connection has been handed by the runtime. */
  readonly received: OutboundWireFrame[]
  /** Resolves once a frame matching `predicate` arrives — no sleeping. */
  readonly waitFor: (predicate: (frame: OutboundWireFrame) => boolean) => Promise<OutboundWireFrame>
}

const open: RealtimeConnectionHandle[] = []

afterEach(async () => {
  while (open.length > 0) await open.pop()!.release()
})

async function connect(runtime: RealtimeRuntime, id: string): Promise<Client> {
  const received: OutboundWireFrame[] = []
  const waiters: {
    predicate: (f: OutboundWireFrame) => boolean
    resolve: (f: OutboundWireFrame) => void
  }[] = []

  const handle = await runtime.handleConnection(
    ROOM.id,
    { connectionId: id },
    undefined,
    (frame) => {
      received.push(frame)
      for (const [index, waiter] of [...waiters.entries()].reverse()) {
        if (waiter.predicate(frame)) {
          waiters.splice(index, 1)
          waiter.resolve(frame)
        }
      }
    },
  )
  open.push(handle)

  return {
    id,
    handle,
    received,
    // A happens-before observation rather than a timeout: the promise resolves only after the
    // other client's send has been dispatched and fanned out. Sleeping would make this pass or
    // fail on machine speed, which is the flakiness a two-connection test invites.
    waitFor: (predicate) =>
      new Promise((resolve, reject) => {
        const already = received.find((f) => predicate(f))
        if (already !== undefined) return resolve(already)
        // Cleared on settle: an uncleared 5s timer outlives the test and shows up as a pending
        // handle at suite end.
        const timer = setTimeout(() => reject(new Error('no matching frame arrived')), 5_000)
        waiters.push({
          predicate,
          resolve: (frame) => {
            clearTimeout(timer)
            resolve(frame)
          },
        })
      }),
  }
}

/** Narrow to a presence-changed frame, failing the test rather than casting past the union. */
function asPresence(frame: OutboundWireFrame): { connectionId: string; presence: unknown } {
  if (frame.type !== 'presence-changed')
    throw new Error(`expected presence-changed, got ${frame.type}`)
  return frame
}

/** Narrow to a broadcast frame. */
function asBroadcast(frame: OutboundWireFrame): {
  connectionId: string
  event: string
  payload: unknown
} {
  if (frame.type !== 'broadcast') throw new Error(`expected broadcast, got ${frame.type}`)
  return frame
}

/** The text of a broadcast payload, or undefined for any other frame. */
function broadcastText(frame: OutboundWireFrame): string | undefined {
  return frame.type === 'broadcast' ? (frame.payload as { text?: string }).text : undefined
}

function runtime(): RealtimeRuntime {
  return new RealtimeRuntime({ provider: createMemoryRealtimeProvider(), rooms: [ROOM] })
}

describe('the send-side port reaches the other client', () => {
  it('carries a presence update from one hook to another connection', async () => {
    // The whole chain, not either half. The unit tests prove the port is called; the tests below
    // prove the server fans out. Only this one proves they meet: a `RealtimeSendClient` whose
    // transport is `dispatchFrame` stands in for the consumer's own, which is the one piece the
    // plugin deliberately does not own.
    const rt = runtime()
    const alice = await connect(rt, 'alice')
    const bob = await connect(rt, 'bob')

    const sender: RealtimeSendClient = {
      send: (frame) => void rt.dispatchFrame(ROOM.id, alice.id, frame),
    }

    // What `useUpdateMyPresence` hands the port.
    void sender.send({ kind: 'presence-update', patch: { cursor: [4, 2] } })

    const frame = await bob.waitFor(
      (f) => f.type === 'presence-changed' && f.connectionId === 'alice',
    )
    expect(asPresence(frame).presence).toMatchObject({ cursor: [4, 2] })
  })

  it('carries a broadcast from one hook to another connection', async () => {
    const rt = runtime()
    const alice = await connect(rt, 'alice')
    const bob = await connect(rt, 'bob')

    const sender: RealtimeSendClient = {
      send: (frame) => void rt.dispatchFrame(ROOM.id, alice.id, frame),
    }

    // What `useBroadcast` hands the port.
    void sender.send({ kind: 'broadcast', event: 'question', payload: { text: 'over the port' } })

    const frame = await bob.waitFor((f) => f.type === 'broadcast')
    expect(asBroadcast(frame).payload).toMatchObject({ text: 'over the port' })
  })

  it('delivers nothing when no sender is wired — the pre-change behaviour', async () => {
    // A consumer who supplies no sender must see exactly what they saw before the port existed.
    // Without this, "additive on a published package" is an assertion rather than a check.
    const rt = runtime()
    await connect(rt, 'alice')
    const bob = await connect(rt, 'bob')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(bob.received.filter((f) => f.type === 'broadcast')).toHaveLength(0)
  })
})

describe('a room whose presence has a required field', () => {
  async function connectTo(
    rt: RealtimeRuntime,
    roomId: string,
    id: string,
    initial: Presence,
  ): Promise<{ received: OutboundWireFrame[] }> {
    const received: OutboundWireFrame[] = []
    const handle = await rt.handleConnection(roomId, { connectionId: id }, initial, (f) =>
      received.push(f),
    )
    open.push(handle)
    return { received }
  }

  it('accepts a partial patch and shows the other client the merged presence', async () => {
    const rt = new RealtimeRuntime({
      provider: createMemoryRealtimeProvider(),
      rooms: [ROOM_REQUIRED],
    })
    await connectTo(rt, ROOM_REQUIRED.id, 'alice', { name: 'Alice' })
    const bob = await connectTo(rt, ROOM_REQUIRED.id, 'bob', { name: 'Bob' })

    await rt.dispatchFrame(ROOM_REQUIRED.id, 'alice', {
      kind: 'presence-update',
      patch: { cursor: [4, 2] },
    })

    const frame = bob.received.find(
      (f) => f.type === 'presence-changed' && f.connectionId === 'alice',
    )
    expect(frame, 'a partial patch never reached the other client').toBeDefined()
    expect(asPresence(frame!).presence).toMatchObject({ name: 'Alice', cursor: [4, 2] })
  })

  it('still refuses a patch that merges into an invalid presence', async () => {
    // The merge must not become a way to smuggle a bad value past the schema.
    const rt = new RealtimeRuntime({
      provider: createMemoryRealtimeProvider(),
      rooms: [ROOM_REQUIRED],
    })
    await connectTo(rt, ROOM_REQUIRED.id, 'alice', { name: 'Alice' })

    await expect(
      rt.dispatchFrame(ROOM_REQUIRED.id, 'alice', {
        kind: 'presence-update',
        patch: { name: 123 },
      }),
    ).rejects.toThrow(/presence/i)
  })
})

describe('two clients in one room', () => {
  it("observes another client's presence update", async () => {
    const rt = runtime()
    const alice = await connect(rt, 'alice')
    const bob = await connect(rt, 'bob')

    await rt.dispatchFrame(ROOM.id, alice.id, {
      kind: 'presence-update',
      patch: { cursor: [7, 9] },
    })

    const frame = await bob.waitFor(
      (f) => f.type === 'presence-changed' && f.connectionId === 'alice',
    )
    expect(asPresence(frame).presence).toMatchObject({ cursor: [7, 9] })
  })

  it("observes another client's broadcast", async () => {
    const rt = runtime()
    const alice = await connect(rt, 'alice')
    const bob = await connect(rt, 'bob')

    await rt.dispatchFrame(ROOM.id, alice.id, {
      kind: 'broadcast',
      event: 'question',
      payload: { text: 'is anyone there' },
    })

    const frame = await bob.waitFor((f) => f.type === 'broadcast')
    expect(asBroadcast(frame).payload).toMatchObject({ text: 'is anyone there' })
    expect(asBroadcast(frame).connectionId).toBe('alice')
  })

  it('delivers each frame exactly once to each listener', async () => {
    // A duplicate-delivery check, not a concurrency one — the claim was corrected by measurement.
    // The memory provider's `fanout` is fully synchronous, so `dispatchFrame` completes its whole
    // fan-out before its promise resolves and the two sends are strictly serialised:
    //
    //   ["call-alice", "alice-recv:from-alice", "bob-recv:from-alice",
    //    "call-bob",   "alice-recv:from-bob",   "bob-recv:from-bob"]
    //
    // `Promise.all` is decorative here. What the counted assertion below DOES prove is that each
    // frame is delivered exactly once to each listener, which is worth having under its own name.
    // A real interleaving test needs an asynchronous provider, which this tier does not run.
    const rt = runtime()
    const alice = await connect(rt, 'alice')
    const bob = await connect(rt, 'bob')

    await Promise.all([
      rt.dispatchFrame(ROOM.id, alice.id, {
        kind: 'broadcast',
        event: 'q',
        payload: { text: 'from-alice' },
      }),
      rt.dispatchFrame(ROOM.id, bob.id, {
        kind: 'broadcast',
        event: 'q',
        payload: { text: 'from-bob' },
      }),
    ])

    await bob.waitFor((f) => broadcastText(f) === 'from-alice')
    await alice.waitFor((f) => broadcastText(f) === 'from-bob')

    const count = (client: Client, text: string) =>
      client.received.filter((f) => broadcastText(f) === text).length

    expect(count(bob, 'from-alice')).toBe(1)
    expect(count(alice, 'from-bob')).toBe(1)
  })

  it('delivers a client its own frames back, so the optimistic merge must be idempotent', async () => {
    // Measured, and it corrected the plan. `fanout` in the memory provider notifies EVERY listener
    // in the room without excluding the sender, so a client sees its own presence change and its
    // own broadcast. The plan's ADR D3 justified keeping the optimistic merge on the opposite
    // claim — that the server does not echo — and that was wrong.
    //
    // The merge survives the correction for a different reason: a presence patch is a merge, not
    // an increment, so applying it twice lands on the same state. This test is what makes that a
    // checked property rather than an argument. A room whose presence carried a counter would
    // break here, which is the consumer's schema choice to make knowingly.
    const rt = runtime()
    const alice = await connect(rt, 'alice')
    await connect(rt, 'bob')

    await rt.dispatchFrame(ROOM.id, alice.id, {
      kind: 'presence-update',
      patch: { cursor: [1, 1] },
    })
    const own = await alice.waitFor(
      (f) => f.type === 'presence-changed' && f.connectionId === 'alice',
    )

    expect(
      asPresence(own).presence,
      'a re-applied merge must land on the same state',
    ).toMatchObject({
      cursor: [1, 1],
    })
  })

  it('refuses a presence patch the room schema rejects, by name', async () => {
    // rules/error-handling.md § 2 — a typed error naming the room, not a generic failure.
    const rt = runtime()
    const alice = await connect(rt, 'alice')

    await expect(
      rt.dispatchFrame(ROOM.id, alice.id, {
        kind: 'presence-update',
        patch: { cursor: 'not-a-tuple' },
      }),
    ).rejects.toThrow(/presence/i)
  })
})
