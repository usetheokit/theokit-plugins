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

import { defineRoom } from '../src/define-room.js'
import { createMemoryRealtimeProvider } from '../src/memory-provider.js'
import { createYjsRealtimeProvider } from '../src/yjs-provider.js'
import { RealtimeRuntime } from '../src/internal/runtime.js'

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

    await expect(rt.dispatchFrame(PLAIN.id, 'alice', UPDATE)).rejects.toThrow(
      /plain.*storage.*yjs/is,
    )
  })

  it('refuses a yjs awareness frame by name instead of dropping it', async () => {
    const rt = new RealtimeRuntime({ provider: createMemoryRealtimeProvider(), rooms: [PLAIN] })

    await expect(rt.dispatchFrame(PLAIN.id, 'alice', AWARENESS)).rejects.toThrow(
      /plain.*storage.*yjs/is,
    )
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
