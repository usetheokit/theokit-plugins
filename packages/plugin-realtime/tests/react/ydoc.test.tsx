// @vitest-environment jsdom
/**
 * The React half of the Yjs bridge — the one piece that was never built.
 *
 * Everything else existed and was proven: the provider, the runtime's inbound handling, both frame
 * kinds in both unions, and a real-WebSocket round trip (`tests/integration/wire-round-trip.test.ts`).
 * What was missing is that `useYDoc()` threw unconditionally and the React reducer dropped
 * `yjs-update` frames on the floor — `RealtimeOutFrame` had no `bytes` field and the switch had no
 * arm for them.
 *
 * These tests drive REAL `Y.Doc` instances rather than fakes. `yjs` is a devDependency here (and
 * an optional peer for consumers), so the real library is available — and a fake document would
 * agree with whatever this file decided a document does, which is the failure mode this repository
 * keeps finding in its own tests.
 */
import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import * as Y from 'yjs'
import { describe, expect, it, vi } from 'vitest'

import {
  type RealtimeOutboundFrame,
  type RealtimeSendClient,
  type RealtimeSubscribeClient,
  RoomProvider,
  useYDoc,
} from '../../src/react/index.js'

/** A client whose stream each test drives, one frame at a time. */
function controllable(): {
  client: RealtimeSubscribeClient
  push: (frame: unknown) => Promise<void>
} {
  const queue: unknown[] = []
  let wake: (() => void) | undefined

  const client: RealtimeSubscribeClient = {
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

  return {
    client,
    push: async (frame) => {
      await act(async () => {
        queue.push(frame)
        wake?.()
        wake = undefined
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
    },
  }
}

/** base64, the way the wire carries it (`server-integration.ts` encodes with Buffer). */
function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function Probe({ onDoc }: { onDoc?: (doc: unknown) => void }): React.ReactElement {
  let error: string | null = null
  try {
    const doc = useYDoc()
    onDoc?.(doc)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  return <span data-testid="err">{error ?? 'ok'}</span>
}

describe('useYDoc', () => {
  it('returns the document the provider was given', () => {
    const doc = new Y.Doc()
    const seen: unknown[] = []
    const { client } = controllable()

    render(
      <RoomProvider roomId="r" client={client} ydoc={doc}>
        <Probe onDoc={(d) => seen.push(d)} />
      </RoomProvider>,
    )

    expect(seen[0]).toBe(doc)
  })

  it('refuses by name when the provider was given no document', () => {
    // The old message named a deferral ("auto-wiring is deferred to v0.x"). The cause is now a
    // missing prop, and the message must say which one — a consumer cannot act on "deferred".
    const { client } = controllable()
    const { getByTestId } = render(
      <RoomProvider roomId="r" client={client}>
        <Probe />
      </RoomProvider>,
    )

    expect(getByTestId('err').textContent).toMatch(/ydoc/i)
  })
})

describe('inbound Yjs frames', () => {
  it('applies an update to the document instead of dropping it', async () => {
    // The whole defect in one assertion: this frame arrived before B-011 too, and fell through
    // the reducer's switch without an arm.
    const source = new Y.Doc()
    source.getText('t').insert(0, 'hello')
    const update = Y.encodeStateAsUpdate(source)

    const target = new Y.Doc()
    const { client, push } = controllable()

    render(
      <RoomProvider roomId="r" client={client} ydoc={target}>
        <Probe />
      </RoomProvider>,
    )

    await push({ type: 'yjs-update', connectionId: 'other', bytes: b64(update) })

    await waitFor(() => expect(target.getText('t').toJSON()).toBe('hello'))
  })

  it('keeps the subscription alive when a frame carries undecodable bytes', async () => {
    // EC-1. The subscription loop's outer `catch` exists to survive a transport failure and cannot
    // tell one from a bad frame. Before this, one corrupt frame ended presence AND broadcast for
    // the whole room, silently — the exact shape `rules/error-handling.md § 5` names.
    const target = new Y.Doc()
    const { client, push } = controllable()
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <RoomProvider roomId="r" client={client} ydoc={target}>
        <Probe />
      </RoomProvider>,
    )

    await push({ type: 'yjs-update', connectionId: 'other', bytes: '!!!not base64!!!' })

    const source = new Y.Doc()
    source.getText('t').insert(0, 'still here')
    await push({
      type: 'yjs-update',
      connectionId: 'other',
      bytes: b64(Y.encodeStateAsUpdate(source)),
    })

    await waitFor(() => expect(target.getText('t').toJSON()).toBe('still here'))
    expect(reported, 'the bad frame was swallowed rather than reported').toHaveBeenCalled()
    reported.mockRestore()
  })

  it('ignores an awareness frame rather than treating it as fatal', async () => {
    // EC-4. Both kinds are routed, but only the document has a destination today.
    const target = new Y.Doc()
    const { client, push } = controllable()

    render(
      <RoomProvider roomId="r" client={client} ydoc={target}>
        <Probe />
      </RoomProvider>,
    )

    await push({ type: 'yjs-awareness', connectionId: 'other', bytes: b64(new Uint8Array([1])) })

    const source = new Y.Doc()
    source.getText('t').insert(0, 'after')
    await push({
      type: 'yjs-update',
      connectionId: 'other',
      bytes: b64(Y.encodeStateAsUpdate(source)),
    })

    await waitFor(() => expect(target.getText('t').toJSON()).toBe('after'))
  })

  it('decodes the bytes without Buffer, which a browser does not have', async () => {
    // R2. `server-integration.ts` encodes with `Buffer`; reusing that on the client would ship a
    // crash to the one surface that always runs in a browser.
    const original = globalThis.Buffer
    const source = new Y.Doc()
    source.getText('t').insert(0, 'browser')
    const encoded = b64(Y.encodeStateAsUpdate(source))

    const target = new Y.Doc()
    const { client, push } = controllable()

    render(
      <RoomProvider roomId="r" client={client} ydoc={target}>
        <Probe />
      </RoomProvider>,
    )

    // @ts-expect-error — deliberately simulating a browser global scope.
    delete globalThis.Buffer
    try {
      await push({ type: 'yjs-update', connectionId: 'other', bytes: encoded })
      await waitFor(() => expect(target.getText('t').toJSON()).toBe('browser'))
    } finally {
      globalThis.Buffer = original
    }
  })

  it('names both decoders when neither atob nor Buffer exists', async () => {
    // EC-5 — a negative case: the failure must name the environment, not surface as
    // "undefined is not a function".
    const originalBuffer = globalThis.Buffer
    const originalAtob = globalThis.atob
    const target = new Y.Doc()
    const { client, push } = controllable()
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <RoomProvider roomId="r" client={client} ydoc={target}>
        <Probe />
      </RoomProvider>,
    )

    // @ts-expect-error — simulating an environment with no base64 decoder at all.
    delete globalThis.Buffer
    // @ts-expect-error — same.
    delete globalThis.atob
    try {
      await push({ type: 'yjs-update', connectionId: 'other', bytes: 'AAA=' })
      await waitFor(() => expect(reported).toHaveBeenCalled())
      const message = reported.mock.calls.flat().map(String).join(' ')
      expect(message).toMatch(/atob/i)
      expect(message).toMatch(/Buffer/i)
    } finally {
      globalThis.Buffer = originalBuffer
      globalThis.atob = originalAtob
      reported.mockRestore()
    }
  })
})

describe('outbound document updates', () => {
  /** A sender that records what the hooks hand it. */
  function recording(): { sender: RealtimeSendClient; sent: RealtimeOutboundFrame[] } {
    const sent: RealtimeOutboundFrame[] = []
    return { sender: { send: (frame) => void sent.push(frame) }, sent }
  }

  it('sends a local document change through the port', async () => {
    const doc = new Y.Doc()
    const { sender, sent } = recording()
    const { client } = controllable()

    render(
      <RoomProvider roomId="r" client={client} ydoc={doc} sender={sender}>
        <Probe />
      </RoomProvider>,
    )

    await act(async () => {
      doc.getText('t').insert(0, 'typed here')
      await Promise.resolve()
    })

    const updates = sent.filter((f) => f.kind === 'yjs-update')
    expect(updates, 'a local edit never reached the transport').toHaveLength(1)
  })

  it('does not send back an update it just received', async () => {
    // R4. Applying a remote update fires the document's own `update` event, so without an origin
    // check every frame is echoed straight back and two clients saturate each other.
    const source = new Y.Doc()
    source.getText('t').insert(0, 'from the wire')

    const doc = new Y.Doc()
    const { sender, sent } = recording()
    const { client, push } = controllable()

    render(
      <RoomProvider roomId="r" client={client} ydoc={doc} sender={sender}>
        <Probe />
      </RoomProvider>,
    )

    await push({
      type: 'yjs-update',
      connectionId: 'other',
      bytes: b64(Y.encodeStateAsUpdate(source)),
    })
    await waitFor(() => expect(doc.getText('t').toJSON()).toBe('from the wire'))

    expect(
      sent.filter((f) => f.kind === 'yjs-update'),
      'the update was echoed back to the sender it came from',
    ).toHaveLength(0)
  })

  it('does not throw on a local change when no sender is wired', async () => {
    // Additive on a published package: a consumer who passes `ydoc` and no `sender` must see the
    // document work locally and nothing blow up.
    const doc = new Y.Doc()
    const { client } = controllable()

    render(
      <RoomProvider roomId="r" client={client} ydoc={doc}>
        <Probe />
      </RoomProvider>,
    )

    await act(async () => {
      doc.getText('t').insert(0, 'local only')
      await Promise.resolve()
    })

    expect(doc.getText('t').toJSON()).toBe('local only')
  })

  it('detaches the document listener on unmount', async () => {
    // An undetached listener outlives the provider and sends through a transport nobody is
    // watching — and a swapped document would be written to by the previous room.
    const doc = new Y.Doc()
    const { sender, sent } = recording()
    const { client } = controllable()

    const view = render(
      <RoomProvider roomId="r" client={client} ydoc={doc} sender={sender}>
        <Probe />
      </RoomProvider>,
    )
    view.unmount()

    await act(async () => {
      doc.getText('t').insert(0, 'after unmount')
      await Promise.resolve()
    })

    expect(sent.filter((f) => f.kind === 'yjs-update')).toHaveLength(0)
  })
})
