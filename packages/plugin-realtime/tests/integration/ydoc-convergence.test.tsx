// @vitest-environment jsdom
/**
 * Two clients, one room, a real WebSocket, and the same document at the end.
 *
 * `wire-round-trip.test.ts` proves an update SURVIVES the socket — that base64 encoding is
 * load-bearing and a `Uint8Array` does not cross `JSON.stringify` intact. That is delivery.
 *
 * Delivery is not the property a CRDT exists to provide. Convergence is: two clients edit WITHOUT
 * having seen each other, and both arrive at the same state. A transport with no merge at all
 * passes a delivery test; only concurrent edits distinguish it.
 *
 * And it drives the REAL `RoomProvider` on both sides rather than re-implementing the client
 * wiring in the test. A first version of this file did re-implement it — decode base64, call
 * `Y.applyUpdate` — and it passed while proving almost nothing new: the server fan-out and the
 * encoding were already covered by `wire-round-trip.test.ts`, and the half B-011 actually built
 * was never touched. A test that stubs the code under test is a test of the stub.
 *
 * The concurrency here is ARRANGED, not hoped for. Both edits are made before either update is
 * dispatched, so neither document had seen the other when it changed. This repository has made the
 * opposite mistake before: B-010 shipped a test named "concurrent" whose two sends were strictly
 * serialised by a synchronous fanout, and the name was the only concurrent thing about it. A test
 * that waits for delivery between edits is checking last-write-wins, and every transport passes.
 */

import type { AddressInfo } from 'node:net'

import { act, render } from '@testing-library/react'
import * as React from 'react'
import * as Y from 'yjs'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  type RealtimeSendClient,
  type RealtimeSubscribeClient,
  RoomProvider,
  useYDoc,
} from '../../src/react/index.js'

import { defineRoom } from '../../src/define-room.js'
import { createYjsRealtimeProvider } from '../../src/yjs-provider.js'
import { RealtimeRuntime } from '../../src/internal/runtime.js'
import {
  mountRealtime,
  type MountedSubscriptionCtx,
  type RealtimeSubscriptionOutput,
} from '../../src/internal/server-integration.js'

const CRDT_ROOM = defineRoom({
  id: 'doc',
  presence: z.object({ name: z.string() }).partial(),
  broadcast: z.object({ kind: z.literal('ping') }),
  storage: 'yjs',
})

const PLAIN_ROOM = defineRoom({
  id: 'plain',
  presence: z.object({ name: z.string() }).partial(),
  broadcast: z.object({ kind: z.literal('ping') }),
})

let server: WebSocketServer
let url: string
const sockets: WebSocket[] = []

beforeEach(async () => {
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  while (sockets.length > 0) sockets.pop()!.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function makeCtx(signal: AbortSignal, connectionId: string): MountedSubscriptionCtx {
  return {
    signal,
    connectionId,
    disconnect: () => {
      /* the socket closing is what ends these tests */
    },
    tracked: <T,>(id: string, payload: T) => [id, payload] as const,
  }
}

/** `ws` hands back RawData in three shapes; decode the bytes rather than stringifying them. */
function decodeFrame(raw: unknown): RealtimeSubscriptionOutput {
  const text = Buffer.isBuffer(raw)
    ? raw.toString('utf8')
    : Array.isArray(raw)
      ? Buffer.concat(raw as Buffer[]).toString('utf8')
      : Buffer.from(raw as ArrayBuffer).toString('utf8')
  return JSON.parse(text) as RealtimeSubscriptionOutput
}

/**
 * Serve each incoming connection its own mounted handler, with its own connectionId.
 *
 * `wire-round-trip.test.ts`'s helper pins one id for the whole server, which is all a
 * single-client suite needs. Two clients need two identities or the runtime cannot tell them
 * apart — and a "convergence" test where both sides are one connection proves nothing.
 */
function serveMany(handler: unknown, ids: readonly string[], controller: AbortController): void {
  let next = 0
  server.on('connection', (socket) => {
    const connectionId = ids[next] ?? `extra-${next}`
    next += 1
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
}

/** A mounted client: the real provider, a real socket, a real document. */
interface Client {
  readonly id: string
  readonly doc: Y.Doc
  readonly view: ReturnType<typeof render>
}

/**
 * A `RealtimeSubscribeClient` whose stream is a real WebSocket.
 *
 * This is the seam the plugin deliberately does not own: the consumer supplies the transport. Here
 * the transport is `ws` against the server standing above, so every frame the provider reduces
 * really crossed a socket and really survived `JSON.stringify`.
 */
function socketClient(socket: WebSocket): RealtimeSubscribeClient {
  const queue: unknown[] = []
  let wake: (() => void) | undefined
  socket.on('message', (raw) => {
    queue.push(decodeFrame(raw))
    wake?.()
    wake = undefined
  })
  return {
    async *subscribe() {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => (wake = resolve))
          continue
        }
        yield queue.shift() as never
      }
    },
  }
}

/** Mount a real `RoomProvider` bound to a real socket and a real document. */
async function connect(roomId: string, id: string, rt: RealtimeRuntime): Promise<Client> {
  const doc = new Y.Doc()
  const socket = new WebSocket(url)
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  const sender: RealtimeSendClient = {
    send: (frame) => rt.dispatchFrame(roomId, id, frame),
  }

  function Probe(): React.ReactElement {
    useYDoc()
    return <span />
  }

  const view = render(
    <RoomProvider roomId={roomId} client={socketClient(socket)} ydoc={doc} sender={sender}>
      <Probe />
    </RoomProvider>,
  )
  return { id, doc, view }
}

/** Wait for a condition without sleeping on a fixed duration. */
async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not reached before the deadline')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('two clients over a real WebSocket', () => {
  it('converge after concurrent edits', async () => {
    const rt = new RealtimeRuntime({ provider: createYjsRealtimeProvider(), rooms: [CRDT_ROOM] })
    const mounted = mountRealtime({ runtime: rt, rooms: [CRDT_ROOM] })
    const controller = new AbortController()
    serveMany(mounted.subscriptions.get('doc')!.handler, ['alice', 'bob'], controller)

    const alice = await connect(CRDT_ROOM.id, 'alice', rt)
    const bob = await connect(CRDT_ROOM.id, 'bob', rt)

    // THE ARRANGEMENT. Both edits happen here, before either has been delivered, so neither
    // document has seen the other's change. Editing one and waiting for it to arrive before
    // editing the other would make the second causally after the first, and the merge — the only
    // thing a CRDT is for — would never be exercised.
    //
    // Nothing is dispatched by hand: the provider's own outbound listener sends each edit through
    // the `sender` port, which is the code path B-011 built.
    await act(async () => {
      alice.doc.getText('body').insert(0, 'alice-wrote-this ')
      bob.doc.getText('body').insert(0, 'bob-wrote-this ')
      await Promise.resolve()
    })

    const both = (text: string): boolean =>
      text.includes('alice-wrote-this') && text.includes('bob-wrote-this')

    await until(() => both(alice.doc.getText('body').toJSON()))
    await until(() => both(bob.doc.getText('body').toJSON()))

    // The property: not "each got the other's bytes", but "both landed on the same state".
    expect(alice.doc.getText('body').toJSON()).toBe(bob.doc.getText('body').toJSON())
    expect(both(alice.doc.getText('body').toJSON())).toBe(true)

    controller.abort()
  })

  it('refuses the update when the room never declared storage:"yjs"', async () => {
    // T1.1's refusal, observed end to end rather than at the unit boundary.
    const rt = new RealtimeRuntime({ provider: createYjsRealtimeProvider(), rooms: [PLAIN_ROOM] })
    const mounted = mountRealtime({ runtime: rt, rooms: [PLAIN_ROOM] })
    const controller = new AbortController()
    serveMany(mounted.subscriptions.get('plain')!.handler, ['alice'], controller)

    const alice = await connect(PLAIN_ROOM.id, 'alice', rt)

    // The provider's own send path is what carries it, so the refusal is the one a consumer meets.
    await expect(
      rt.dispatchFrame(PLAIN_ROOM.id, 'alice', {
        kind: 'yjs-update',
        bytes: Y.encodeStateAsUpdate(alice.doc),
      }),
    ).rejects.toThrow(/does not declare storage/i)

    controller.abort()
  })
})
