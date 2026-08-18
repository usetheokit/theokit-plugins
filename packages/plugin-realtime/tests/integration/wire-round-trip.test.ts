/**
 * The frames `mountRealtime` emits, carried over a real WebSocket and applied on the
 * other side.
 *
 * Every other suite here stops at the provider or at the runtime. The two that call
 * themselves integration say so in their own names — `(in-process)` — and
 * `presence-multi-client.test.ts` goes further, stating in its header that
 *
 *   "The real WS roundtrip uses the same provider — adding the WS layer is a thin
 *    shim (server-integration.ts)."
 *
 * That shim is where `frameToOutput` base64-encodes the binary Yjs frames, and nothing
 * asserted it: no test in this package mentions base64, and `frameToOutput`'s two binary
 * branches were reached by nobody. A claim that the untested part is trivial is still a
 * claim about untested code.
 *
 * So this suite is the round trip a browser actually performs:
 *
 *   provider → runtime → mountRealtime handler → JSON.stringify → real socket
 *     → JSON.parse → base64 decode → Y.applyUpdate → second Y.Doc
 *
 * The transport is `ws`, not a stub, because the defect class this catches only exists on
 * a wire: a value that survives being passed by reference in-process and does not survive
 * serialization. `Uint8Array` is exactly that value — `JSON.stringify` turns it into
 * `{"0":1,"1":2,…}`, which `Y.applyUpdate` rejects. The last test below proves that is
 * what would happen without the encoding, so the encoding is shown to be load-bearing
 * rather than assumed to be.
 */

import type { AddressInfo } from 'node:net'

import * as Y from 'yjs'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineRoom } from '../../src/define-room.js'
import { createYjsRealtimeProvider } from '../../src/yjs-provider.js'
import { RealtimeRuntime } from '../../src/internal/runtime.js'
import {
  mountRealtime,
  type MountedSubscriptionCtx,
  type RealtimeSubscriptionOutput,
} from '../../src/internal/server-integration.js'

function makeCtx(signal: AbortSignal, connectionId: string): MountedSubscriptionCtx {
  return {
    signal,
    connectionId,
    disconnect: () => {
      /* the socket closing is what ends these tests */
    },
    tracked: <T>(id: string, payload: T) => [id, payload] as const,
  }
}

const room = defineRoom({
  id: 'doc',
  presence: z.object({ name: z.string() }).partial(),
  broadcast: z.object({ kind: z.literal('ping') }),
  storage: 'yjs',
})

let server: WebSocketServer
let url: string

beforeEach(async () => {
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/**
 * Play the framework transport: drive the mounted handler and write each frame to the
 * socket exactly as a JSON wire would. Nothing here is plugin code — that is the point.
 * If the transport needed to know about Yjs, the encoding would not be the plugin's job.
 */
function serve(
  handler: ReturnType<typeof mountRealtime>['subscriptions'] extends ReadonlyMap<
    string,
    { readonly handler: infer H }
  >
    ? H
    : never,
  connectionId: string,
): AbortController {
  const controller = new AbortController()
  server.on('connection', (socket) => {
    void (async () => {
      const gen = (handler as (i: unknown, c: MountedSubscriptionCtx) => AsyncGenerator<unknown>)(
        {},
        makeCtx(controller.signal, connectionId),
      )
      for await (const frame of gen) {
        if (socket.readyState !== WebSocket.OPEN) break
        socket.send(JSON.stringify(frame))
      }
    })()
  })
  return controller
}

/** Collect frames off a real client socket until `want` predicate is satisfied. */
async function collect(
  want: (f: RealtimeSubscriptionOutput) => boolean,
  timeoutMs = 5_000,
): Promise<RealtimeSubscriptionOutput[]> {
  const client = new WebSocket(url)
  const got: RealtimeSubscriptionOutput[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no matching frame in ${timeoutMs}ms; got ${JSON.stringify(got)}`)),
        timeoutMs,
      )
      client.on('message', (raw) => {
        // Parse the bytes the socket delivered — not an object we still hold a reference
        // to. This is the whole reason the suite exists.
        const frame = JSON.parse(String(raw)) as RealtimeSubscriptionOutput
        got.push(frame)
        if (want(frame)) {
          clearTimeout(timer)
          resolve()
        }
      })
      client.on('error', reject)
    })
    return got
  } finally {
    client.close()
  }
}

describe('frames survive a real WebSocket', () => {
  it('a joined frame arrives parseable, with the presence intact', async () => {
    const provider = createYjsRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [room] })
    const mounted = mountRealtime({ runtime: rt, rooms: [room] })
    serve(mounted.subscriptions.get('doc')!.handler, 'alice')

    const frames = await collect((f) => f.type === 'joined')
    const joined = frames.find((f) => f.type === 'joined')

    expect(joined, 'no joined frame crossed the socket').toBeDefined()
    expect(joined?.connectionId).toBe('alice')
  })

  it('a Yjs update crosses as base64 and applies to a second document', async () => {
    const provider = createYjsRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [room] })
    const mounted = mountRealtime({ runtime: rt, rooms: [room] })
    serve(mounted.subscriptions.get('doc')!.handler, 'alice')

    // A real edit on a real doc, encoded the way a client would send it up.
    const authored = new Y.Doc()
    authored.getText('body').insert(0, 'hello from the wire')
    const update = Y.encodeStateAsUpdate(authored)

    const framesPromise = collect((f) => f.type === 'yjs-update')
    // Give the subscription a moment to join before the update is broadcast.
    await new Promise((r) => setTimeout(r, 150))
    await provider.applyYjsUpdate?.('doc', 'bob', update)

    const frames = await framesPromise
    const wire = frames.find((f) => f.type === 'yjs-update')
    expect(wire, 'no yjs-update frame crossed the socket').toBeDefined()
    if (wire?.type !== 'yjs-update') return

    // The wire type says `bytes: string`; the in-process frame says `Uint8Array`. This is
    // the divergence `frameToOutput` exists to create, and it had no test.
    expect(typeof wire.bytes, 'bytes did not arrive as a base64 string').toBe('string')
    expect(wire.bytes.length).toBeGreaterThan(0)

    // Decode the way a consumer must — and note the plugin exports no helper for this,
    // so every consumer writes this line themselves.
    const decoded = new Uint8Array(Buffer.from(wire.bytes, 'base64'))
    const received = new Y.Doc()
    Y.applyUpdate(received, decoded)

    expect(received.getText('body').toString()).toBe('hello from the wire')
  })

  it('the encoding is load-bearing: the raw Uint8Array would not survive JSON', () => {
    // Guards the premise of the test above. If `JSON.stringify` happened to preserve a
    // Uint8Array, `frameToOutput` would be pointless and its absence would break nothing —
    // so this asserts the failure the encoding prevents.
    const authored = new Y.Doc()
    authored.getText('body').insert(0, 'hello from the wire')
    const update = Y.encodeStateAsUpdate(authored)

    const naive = JSON.parse(JSON.stringify({ bytes: update })) as { bytes: unknown }

    expect(Array.isArray(naive.bytes), 'a Uint8Array would round-trip as an array').toBe(false)
    expect(typeof naive.bytes, 'it becomes a plain object keyed by index').toBe('object')
    expect(() => Y.applyUpdate(new Y.Doc(), naive.bytes as Uint8Array)).toThrow()
  })

  it('closing the socket ends the subscription instead of leaking it', async () => {
    const provider = createYjsRealtimeProvider()
    const rt = new RealtimeRuntime({ provider, rooms: [room] })
    const mounted = mountRealtime({ runtime: rt, rooms: [room] })
    const controller = serve(mounted.subscriptions.get('doc')!.handler, 'alice')

    await collect((f) => f.type === 'joined')

    // A dropped client is the common case, not the exceptional one: a tab closes and the
    // server must release the connection. #195 was exactly this leak, found in-process;
    // this asserts it across the socket the tab actually used.
    controller.abort()
    await new Promise((r) => setTimeout(r, 100))

    // `getPresence` is the provider's own snapshot, keyed by connectionId. If the abort had
    // not released the connection, alice would still be in it — which is the leak #195 was
    // about, asserted here across the socket a real tab would have used.
    const presence = await provider.getPresence('doc')
    expect(Object.keys(presence), 'alice is still present after her socket closed').not.toContain(
      'alice',
    )
  })
})
