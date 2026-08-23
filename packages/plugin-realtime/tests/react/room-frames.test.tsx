// @vitest-environment jsdom
/**
 * `RoomProvider` — the frames a room sends, turned into what the hooks return.
 *
 * `use-room.test.tsx` covers the happy path with a fixed two-frame stub. What it cannot reach is
 * everything that depends on WHICH frame arrives and in what order: the reducer was at 53.12%
 * branch coverage, and the branch that decides whether a `joined` frame is YOU or somebody else
 * is the one the whole presence model rests on.
 *
 * The client here is push-driven rather than a fixed script, so each test states the exact
 * sequence a room would deliver.
 */
import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'

import {
  type RealtimeOutboundFrame,
  type RealtimeSendClient,
  type RealtimeSubscribeClient,
  RoomProvider,
  useBroadcast,
  useOthers,
  usePresence,
  useRoom,
  useYDoc,
} from '../../src/react/index.js'

/** A client whose stream this test drives, one frame at a time. */
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
        // Two ticks: one for the generator to resume, one for React to commit.
        await Promise.resolve()
        await Promise.resolve()
      })
    },
  }
}

function State(): React.ReactElement {
  const room = useRoom()
  const others = useOthers()
  const presence = usePresence()
  return (
    <div>
      <span data-testid="conn">{room.connectionId ?? 'null'}</span>
      <span data-testid="mine">{JSON.stringify(presence)}</span>
      <span data-testid="others">{JSON.stringify(others)}</span>
    </div>
  )
}

function mount(client: RealtimeSubscribeClient): ReturnType<typeof render> {
  return render(
    <RoomProvider roomId="room-1" client={client} initialPresence={{ name: 'me' }}>
      <State />
    </RoomProvider>,
  )
}

const read = (id: string): string =>
  document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''

describe('RoomProvider frame reduction', () => {
  it('reads the FIRST joined frame as the local client, not as another participant', async () => {
    // The discriminator the presence model rests on: until a connectionId is known, a `joined`
    // frame is this client's own. Getting it wrong puts the user in their own `others` list and
    // leaves `connectionId` null forever.
    const { client, push } = controllable()
    mount(client)

    await push({ type: 'joined', connectionId: 'me-1', presence: { name: 'me' } })

    await waitFor(() => expect(read('conn')).toBe('me-1'))
    expect(read('others'), 'the local client must not be in others').toBe('{}')
  })

  it('reads a later joined frame as another participant', async () => {
    const { client, push } = controllable()
    mount(client)

    await push({ type: 'joined', connectionId: 'me-1', presence: { name: 'me' } })
    await push({ type: 'joined', connectionId: 'other-1', presence: { name: 'Grace' } })

    await waitFor(() => expect(read('others')).toBe('{"other-1":{"name":"Grace"}}'))
    expect(read('conn'), 'the local connectionId must not change').toBe('me-1')
  })

  it('routes a presence change to the local client when it is our own id', async () => {
    const { client, push } = controllable()
    mount(client)

    await push({ type: 'joined', connectionId: 'me-1', presence: { name: 'me' } })
    await push({ type: 'presence-changed', connectionId: 'me-1', presence: { name: 'renamed' } })

    await waitFor(() => expect(read('mine')).toBe('{"name":"renamed"}'))
    expect(read('others'), 'our own change must not appear in others').toBe('{}')
  })

  it('routes a presence change to others when it is somebody else', async () => {
    const { client, push } = controllable()
    mount(client)

    await push({ type: 'joined', connectionId: 'me-1', presence: { name: 'me' } })
    await push({ type: 'presence-changed', connectionId: 'other-1', presence: { cursor: [1, 2] } })

    await waitFor(() => expect(read('others')).toBe('{"other-1":{"cursor":[1,2]}}'))
    expect(read('mine'), 'somebody else must not overwrite our presence').toBe('{"name":"me"}')
  })

  it('removes a participant who left', async () => {
    const { client, push } = controllable()
    mount(client)

    await push({ type: 'joined', connectionId: 'me-1', presence: {} })
    await push({ type: 'joined', connectionId: 'other-1', presence: { name: 'Grace' } })
    await waitFor(() => expect(read('others')).toBe('{"other-1":{"name":"Grace"}}'))

    await push({ type: 'left', connectionId: 'other-1' })
    await waitFor(() => expect(read('others')).toBe('{}'))
  })
})

describe('RoomProvider malformed frames', () => {
  // Frames arrive from the wire. A field the type promises can still be missing, and the
  // reducer's guards are the only thing standing between that and a room keyed by `undefined`.

  it('ignores a left frame with no connectionId', async () => {
    const { client, push } = controllable()
    mount(client)
    await push({ type: 'joined', connectionId: 'me-1', presence: {} })
    await push({ type: 'joined', connectionId: 'other-1', presence: { name: 'Grace' } })

    await push({ type: 'left' })

    expect(read('others'), 'a nameless departure must not clear the room').toBe(
      '{"other-1":{"name":"Grace"}}',
    )
  })

  it('ignores a presence change with no presence', async () => {
    const { client, push } = controllable()
    mount(client)
    await push({ type: 'joined', connectionId: 'me-1', presence: { name: 'me' } })

    await push({ type: 'presence-changed', connectionId: 'me-1' })

    expect(read('mine')).toBe('{"name":"me"}')
  })

  it('leaves state untouched for a broadcast frame', async () => {
    // Broadcast is deliberately not state — asserting it here stops a future reducer from
    // quietly starting to write one.
    const { client, push } = controllable()
    mount(client)
    await push({ type: 'joined', connectionId: 'me-1', presence: { name: 'me' } })

    await push({ type: 'broadcast', connectionId: 'other-1', event: 'ping', payload: { a: 1 } })

    expect(read('mine')).toBe('{"name":"me"}')
    expect(read('others')).toBe('{}')
  })
})

describe('RoomProvider deferred surface', () => {
  it('useBroadcast returns a callable that is local-only in v0.1', () => {
    // The README states this in bold: "Local-only in v0.1 — events are scoped to the current
    // client and do not fan out to other participants yet". The assertion is that calling it is
    // safe, not that it sends — pinning the documented contract rather than a wish.
    function Broadcaster(): React.ReactElement {
      const broadcast = useBroadcast()
      return (
        <button type="button" onClick={() => broadcast('ping', { a: 1 })}>
          send
        </button>
      )
    }
    const { client } = controllable()
    render(
      <RoomProvider roomId="room-1" client={client}>
        <Broadcaster />
      </RoomProvider>,
    )

    const button = document.querySelector('button') as HTMLButtonElement
    expect(() => button.click()).not.toThrow()
  })

  it('useYDoc refuses, and its message says what to do instead', () => {
    // The honest shape for a deferred feature: it throws rather than returning something that
    // silently does nothing, and the error names the workaround.
    function Doc(): React.ReactElement {
      useYDoc()
      return <span>unreachable</span>
    }
    const { client } = controllable()
    expect(() =>
      render(
        <RoomProvider roomId="room-1" client={client}>
          <Doc />
        </RoomProvider>,
      ),
    ).toThrow(/useYDoc.*storage: 'yjs'.*useBroadcast/s)
  })
})

describe('useRoom() object surface', () => {
  it('carries updateMyPresence and broadcast, distinct from the dedicated hooks', async () => {
    // `useRoom()` returns these alongside the standalone `useUpdateMyPresence` / `useBroadcast`.
    // Two ways to reach the same behaviour means two things to keep working, and only one of
    // them was exercised.
    function ViaRoomObject(): React.ReactElement {
      const room = useRoom()
      return (
        <div>
          <span data-testid="mine">{JSON.stringify(room.myPresence)}</span>
          <button
            type="button"
            data-testid="update"
            onClick={() => room.updateMyPresence({ cursor: [3, 4] })}
          >
            update
          </button>
          <button type="button" data-testid="cast" onClick={() => room.broadcast('ping', { a: 1 })}>
            cast
          </button>
        </div>
      )
    }
    const { client, push } = controllable()
    render(
      <RoomProvider roomId="room-1" client={client} initialPresence={{ name: 'me' }}>
        <ViaRoomObject />
      </RoomProvider>,
    )
    await push({ type: 'joined', connectionId: 'me-1', presence: { name: 'me' } })

    await act(async () => {
      ;(document.querySelector('[data-testid="update"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(read('mine')).toBe('{"name":"me","cursor":[3,4]}')

    // Local-only in v0.1, like its standalone twin: the assertion is that it is safe to call.
    expect(() =>
      (document.querySelector('[data-testid="cast"]') as HTMLButtonElement).click(),
    ).not.toThrow()
  })
})

describe('RoomProvider send-side port', () => {
  /** A sender that records what the hooks hand it. */
  function recording(): { sender: RealtimeSendClient; sent: RealtimeOutboundFrame[] } {
    const sent: RealtimeOutboundFrame[] = []
    return { sender: { send: (frame) => void sent.push(frame) }, sent }
  }

  it('sends a presence-update frame when a sender is supplied', () => {
    const { client } = controllable()
    const { sender, sent } = recording()
    let room: ReturnType<typeof useRoom> | undefined

    function Probe(): null {
      room = useRoom()
      return null
    }
    render(
      <RoomProvider roomId="r" client={client} sender={sender}>
        <Probe />
      </RoomProvider>,
    )

    act(() => {
      room!.updateMyPresence({ cursor: [1, 2] })
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ kind: 'presence-update', patch: { cursor: [1, 2] } })
  })

  it('sends a broadcast frame when a sender is supplied', () => {
    const { client } = controllable()
    const { sender, sent } = recording()
    let room: ReturnType<typeof useRoom> | undefined

    function Probe(): null {
      room = useRoom()
      return null
    }
    render(
      <RoomProvider roomId="r" client={client} sender={sender}>
        <Probe />
      </RoomProvider>,
    )

    act(() => {
      room!.broadcast('question', { text: 'hi' })
    })

    expect(sent).toEqual([{ kind: 'broadcast', event: 'question', payload: { text: 'hi' } }])
  })

  it('still merges presence optimistically when a sender is supplied', () => {
    // The local update is not traded for the remote one: the server does not echo the sender's own
    // frame back, so waiting for it would mean the update never arrives.
    const { client } = controllable()
    const { sender } = recording()
    let room: ReturnType<typeof useRoom> | undefined

    function Probe(): null {
      room = useRoom()
      return null
    }
    render(
      <RoomProvider roomId="r" client={client} sender={sender}>
        <Probe />
      </RoomProvider>,
    )

    act(() => {
      room!.updateMyPresence({ cursor: [3, 4] })
    })

    expect(room!.myPresence).toMatchObject({ cursor: [3, 4] })
  })

  it('sends nothing and still merges locally when no sender is supplied', () => {
    // The behaviour every current consumer has, pinned — the port is additive on a published
    // package, and this is what makes that claim checkable rather than asserted.
    const { client } = controllable()
    let room: ReturnType<typeof useRoom> | undefined

    function Probe(): null {
      room = useRoom()
      return null
    }
    render(
      <RoomProvider roomId="r" client={client}>
        <Probe />
      </RoomProvider>,
    )

    act(() => {
      room!.updateMyPresence({ cursor: [5, 6] })
      room!.broadcast('question', { text: 'ignored' })
    })

    expect(room!.myPresence).toMatchObject({ cursor: [5, 6] })
  })

  it('lets a failing transport surface rather than swallowing it', () => {
    // rules/error-handling.md § 2: a transport that is down is the consumer's to handle, and a
    // hook that swallowed it would leave them with a UI that looks synced and is not.
    const { client } = controllable()
    const failing: RealtimeSendClient = {
      send: () => {
        throw new Error('transport down')
      },
    }
    let room: ReturnType<typeof useRoom> | undefined

    function Probe(): null {
      room = useRoom()
      return null
    }
    render(
      <RoomProvider roomId="r" client={client} sender={failing}>
        <Probe />
      </RoomProvider>,
    )

    expect(() => room!.broadcast('question', { text: 'hi' })).toThrow('transport down')
  })
})
