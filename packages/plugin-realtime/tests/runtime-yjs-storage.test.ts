/**
 * A room that never declared CRDT storage must not receive CRDT state.
 *
 * `room.storage` was read in exactly one place — inside the "this provider cannot do Yjs" branch
 * of `dispatchFrame` — which left both paths around it wrong:
 *
 *   - a Yjs frame on a non-Yjs room with a non-Yjs provider hit a bare `return`, so the frame
 *     vanished with no error (a swallow, against `rules/error-handling.md § 2`);
 *   - the same frame with a Yjs-CAPABLE provider never consulted `room.storage` at all and was
 *     applied, writing document state into a room whose descriptor never opted in.
 *
 * The declaration is what the check must hang on, so the check goes first — before the branch on
 * provider capability, which answers a different question.
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import * as Y from 'yjs'

import { defineRoom } from '../src/define-room.js'
import { createMemoryRealtimeProvider } from '../src/memory-provider.js'
import { createYjsRealtimeProvider } from '../src/yjs-provider.js'
import { encodeYjsBytes, type InboundWireFrame, RealtimeRuntime } from '../src/internal/runtime.js'

const PLAIN = defineRoom({
  id: 'plain',
  presence: z.object({ name: z.string().optional() }),
  broadcast: z.object({ text: z.string() }),
})

const CRDT = defineRoom({
  id: 'crdt',
  presence: z.object({ name: z.string().optional() }),
  broadcast: z.object({ text: z.string() }),
  storage: 'yjs',
})

const UPDATE = { kind: 'yjs-update', bytes: new Uint8Array([1, 2, 3]) } as const
const AWARENESS = { kind: 'yjs-awareness', bytes: new Uint8Array([1, 2, 3]) } as const

describe('a room without storage:"yjs"', () => {
  it('refuses a yjs update by name instead of dropping it', async () => {
    // Before: `return` at runtime.ts:239 — the frame disappeared and the sender learned nothing.
    const rt = new RealtimeRuntime({ provider: createMemoryRealtimeProvider(), rooms: [PLAIN] })

    // The assertion must DISCRIMINATE. `/plain.*storage.*yjs/` also matches the pre-existing
    // capability error — "Room plain DECLARES storage:\"yjs\" but provider memory does not…" —
    // whose text asserts the opposite fact. Measured: with `assertYjsRoom` made a no-op, this test
    // passed on that message. An assertion satisfied by the negation of its own title is not one.
    await expect(rt.dispatchFrame(PLAIN.id, 'alice', UPDATE)).rejects.toThrow(
      /does not declare storage/i,
    )
  })

  it('refuses a yjs awareness frame by name instead of dropping it', async () => {
    // Its own test, and its own discriminating regex. Deleting ONLY the awareness call to
    // `assertYjsRoom` left the whole 98-test package green before this — the awareness half of
    // the fix was guarded by nothing.
    const rt = new RealtimeRuntime({ provider: createMemoryRealtimeProvider(), rooms: [PLAIN] })

    await expect(rt.dispatchFrame(PLAIN.id, 'alice', AWARENESS)).rejects.toThrow(
      /does not declare storage/i,
    )
  })

  it('does not apply the awareness frame even when the provider is Yjs-capable', async () => {
    const provider = createYjsRealtimeProvider()
    const apply = vi.spyOn(provider, 'applyYjsAwareness')
    const rt = new RealtimeRuntime({ provider, rooms: [PLAIN] })

    await expect(rt.dispatchFrame(PLAIN.id, 'alice', AWARENESS)).rejects.toThrow(
      /does not declare storage/i,
    )
    expect(
      apply,
      'awareness state was written into a room that never declared it',
    ).not.toHaveBeenCalled()
  })

  it('does not apply the update even when the provider is Yjs-capable', async () => {
    // The inverse hole, and the worse one: the capability branch was never entered, so
    // `applyYjsUpdate` ran for a room whose descriptor never declared CRDT storage.
    const provider = createYjsRealtimeProvider()
    const apply = vi.spyOn(provider, 'applyYjsUpdate')
    const rt = new RealtimeRuntime({ provider, rooms: [PLAIN] })

    await expect(rt.dispatchFrame(PLAIN.id, 'alice', UPDATE)).rejects.toThrow(/storage/i)
    expect(
      apply,
      'CRDT state was written into a room that never declared it',
    ).not.toHaveBeenCalled()
  })
})

describe('a room that does declare storage:"yjs"', () => {
  it('still reports the provider misconfiguration by its own code', async () => {
    // The pre-existing behaviour must survive the reordering: this is a DIFFERENT fault from the
    // one above, and collapsing the two would send a reader to fix the wrong thing.
    const rt = new RealtimeRuntime({ provider: createMemoryRealtimeProvider(), rooms: [CRDT] })

    await expect(rt.dispatchFrame(CRDT.id, 'alice', UPDATE)).rejects.toThrow(
      /does not implement applyYjsUpdate/,
    )
  })

  it('applies the update when the provider supports it', async () => {
    const provider = createYjsRealtimeProvider()
    const apply = vi.spyOn(provider, 'applyYjsUpdate')
    const rt = new RealtimeRuntime({ provider, rooms: [CRDT] })

    await rt.dispatchFrame(CRDT.id, 'alice', UPDATE)

    expect(apply).toHaveBeenCalledWith(CRDT.id, 'alice', UPDATE.bytes)
  })
})

describe('the frame the client actually puts on the wire', () => {
  it('survives JSON and still applies', async () => {
    // The defect this pins: `RealtimeSendClient.send` was handed a raw `Uint8Array`, and the
    // README's own canonical transport is `socket.send(JSON.stringify(frame))`. Composed, the
    // server receives `{"0":1,"1":1,…}` and `Y.applyUpdate` throws "Unexpected end of array".
    //
    // The server→client direction already solved this: `server-integration.ts` base64-encodes
    // because binary does not cross JSON. This is the same fix on the other half, which had none.
    const provider = createYjsRealtimeProvider()
    const apply = vi.spyOn(provider, 'applyYjsUpdate')
    const rt = new RealtimeRuntime({ provider, rooms: [CRDT] })

    const authored = new Y.Doc()
    authored.getText('body').insert(0, 'across the wire')
    const bytes = Y.encodeStateAsUpdate(authored)

    // Exactly what a consumer's transport does on each side of the socket.
    const onTheWire = JSON.stringify({ kind: 'yjs-update', bytes: encodeYjsBytes(bytes) })
    const received = JSON.parse(onTheWire) as InboundWireFrame

    await rt.dispatchFrame(CRDT.id, 'alice', received)

    expect(apply).toHaveBeenCalledTimes(1)
    const delivered = apply.mock.calls[0]![2]
    expect(delivered, 'the provider was handed something that is not bytes').toBeInstanceOf(
      Uint8Array,
    )

    // And the bytes still mean what they meant: they apply to a fresh document.
    const target = new Y.Doc()
    Y.applyUpdate(target, delivered)
    expect(target.getText('body').toJSON()).toBe('across the wire')
  })

  it('still accepts raw bytes, so an in-process caller is unaffected', async () => {
    // Additive on a published type: `dispatchFrame` is public and consumers already call it with
    // a `Uint8Array` from their own decoding.
    const provider = createYjsRealtimeProvider()
    const apply = vi.spyOn(provider, 'applyYjsUpdate')
    const rt = new RealtimeRuntime({ provider, rooms: [CRDT] })

    await rt.dispatchFrame(CRDT.id, 'alice', UPDATE)

    expect(apply).toHaveBeenCalledWith(CRDT.id, 'alice', UPDATE.bytes)
  })

  it('names the frame when the base64 is not decodable', async () => {
    const rt = new RealtimeRuntime({ provider: createYjsRealtimeProvider(), rooms: [CRDT] })

    await expect(
      rt.dispatchFrame(CRDT.id, 'alice', { kind: 'yjs-update', bytes: '!!!not base64!!!' }),
    ).rejects.toThrow(/base64|decode/i)
  })
})
