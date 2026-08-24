/**
 * A client that subscribes to a live room receives the document, not an empty one.
 *
 * Before this, the second person to open a document saw nothing until somebody typed. Measured
 * 2026-08-24 by running it: alice edits, bob subscribes, and bob receives `[ 'joined' ]` with a
 * document of `""`. The provider held the full Y.Doc in memory the whole time; what it lacked was a
 * way to address one client. `fanout` iterates listeners with no identity and `joinRoom` receives a
 * connection with no channel back — `subscribeRoom` is the only point in the contract holding both.
 *
 * The frame is an ordinary `yjs-update`. In Yjs a full state encoding IS an update, consumed by the
 * same `applyUpdate`, so a client needs no new frame type and no branch to accept one. See the ADR
 * in the plan for why this rather than a state-vector exchange.
 */

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createYjsRealtimeProvider } from '../src/yjs-provider.js'
import type { RealtimeFrame } from '../src/types.js'

/** A client that wires whatever the room sends into its own document, as the React surface does. */
function client(p: ReturnType<typeof createYjsRealtimeProvider>, roomId: string) {
  const doc = new Y.Doc()
  const frames: RealtimeFrame[] = []
  const unsubscribe = p.subscribeRoom(roomId, (f) => {
    frames.push(f)
    if (f.type === 'yjs-update') Y.applyUpdate(doc, (f as { bytes: Uint8Array }).bytes)
  })
  // `toJSON()` rather than `toString()`: the same string, and it is the accessor yjs types as
  // returning one — `no-base-to-string` reads the other as Object's default stringification.
  return { doc, frames, unsubscribe, text: () => doc.getText('t').toJSON() }
}

/** Lets any async initial-sync path run — the doc load is dynamic `import('yjs')`. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

describe('a client joining a live document', () => {
  it('receives what was written before it arrived', async () => {
    const p = createYjsRealtimeProvider()
    await p.joinRoom('doc', { connectionId: 'alice' })

    const alice = new Y.Doc()
    alice.getText('t').insert(0, 'hello from alice')
    await p.applyYjsUpdate!('doc', 'alice', Y.encodeStateAsUpdate(alice))

    const bob = client(p, 'doc')
    await p.joinRoom('doc', { connectionId: 'bob' })
    await settle()

    expect(bob.text()).toBe('hello from alice')
  })

  it('receives it on subscribe, without the receiver having joined', async () => {
    // The identity that makes this possible belongs to `subscribeRoom`, so that is where the sync
    // fires — a consumer that subscribes and never calls `joinRoom` still gets the document.
    //
    // Alice must join, though, and that is not incidental: with no presence and no listener,
    // `gcIfEmpty` destroys the room's doc the moment her apply finishes. The first draft of this
    // test omitted her join and failed with an empty document — the provider was right and the test
    // was encoding an assumption about room lifetime that this package deliberately does not hold.
    // Nothing here persists a document; see the note on the last case.
    const p = createYjsRealtimeProvider()
    await p.joinRoom('doc', { connectionId: 'alice' })

    const alice = new Y.Doc()
    alice.getText('t').insert(0, 'written first')
    await p.applyYjsUpdate!('doc', 'alice', Y.encodeStateAsUpdate(alice))

    const bob = client(p, 'doc')
    await settle()

    expect(bob.text()).toBe('written first')
  })

  it('sends nothing to a subscriber of an empty room', async () => {
    // An empty document encodes to a non-empty byte string, so a naive implementation sends a frame
    // that carries nothing. Every subscriber to every room would then receive a pointless update.
    const p = createYjsRealtimeProvider()
    const bob = client(p, 'fresh')
    await settle()

    expect(bob.frames.filter((f) => f.type === 'yjs-update')).toHaveLength(0)
  })

  it('does not send the state to the OTHER subscribers already in the room', async () => {
    // The whole point is a targeted delivery. If the sync went through `fanout`, every existing
    // client would be re-sent the full document on each new arrival — O(document × participants),
    // and worse, it would look correct because Yjs is idempotent.
    const p = createYjsRealtimeProvider()
    await p.joinRoom('doc', { connectionId: 'alice' })

    const alice = new Y.Doc()
    alice.getText('t').insert(0, 'shared')
    await p.applyYjsUpdate!('doc', 'alice', Y.encodeStateAsUpdate(alice))

    const first = client(p, 'doc')
    await settle()
    const beforeSecondJoins = first.frames.filter((f) => f.type === 'yjs-update').length

    const second = client(p, 'doc')
    await settle()

    expect(second.text()).toBe('shared')
    expect(
      first.frames.filter((f) => f.type === 'yjs-update').length,
      'the existing client was re-sent the document when somebody else arrived',
    ).toBe(beforeSecondJoins)
  })

  it('an unattended room keeps nothing — the documented limit, asserted', async () => {
    // Not a defect and worth pinning: with no presence and no listener, `gcIfEmpty` destroys the
    // doc. A client arriving after the last participant leaves gets an empty document, because
    // nothing in this package persists one. Asserting it stops the behaviour being rediscovered as
    // a bug, and makes it visible the day persistence lands.
    const p = createYjsRealtimeProvider()
    const alice = new Y.Doc()
    alice.getText('t').insert(0, 'nobody was watching')
    await p.applyYjsUpdate!('doc', 'alice', Y.encodeStateAsUpdate(alice))

    const bob = client(p, 'doc')
    await settle()

    expect(bob.text()).toBe('')
  })

  it('stops sending after unsubscribe', async () => {
    const p = createYjsRealtimeProvider()
    await p.joinRoom('doc', { connectionId: 'alice' })
    const alice = new Y.Doc()
    alice.getText('t').insert(0, 'x')
    await p.applyYjsUpdate!('doc', 'alice', Y.encodeStateAsUpdate(alice))

    const bob = client(p, 'doc')
    bob.unsubscribe()
    await settle()

    // Unsubscribing before the async sync resolves must not deliver into a torn-down listener.
    expect(bob.frames.filter((f) => f.type === 'yjs-update')).toHaveLength(0)
  })
})
