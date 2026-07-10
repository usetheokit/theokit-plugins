// @vitest-environment jsdom
/**
 * P#9 T3.3 — React hooks scaffold test.
 *
 * Validates: RoomProvider mounts; useRoom returns correct roomId; consumer
 * can read myPresence + others; updateMyPresence merges optimistically.
 *
 * Uses a stub `RealtimeSubscribeClient` (the AsyncGenerator yields a single
 * `joined` event then completes) — the integration with G8 transport is
 * covered by tests/integration/presence-multi-client.test.ts (server side).
 */
import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import {
  type RealtimeSubscribeClient,
  RoomProvider,
  useOthers,
  usePresence,
  useRoom,
  useUpdateMyPresence,
} from '../../src/react/index.js'

const stubClient: RealtimeSubscribeClient = {
  async *subscribe(_name, input) {
    // Yield to the microtask queue so this satisfies the AsyncGenerator contract
    // without changing observable behavior (iteration already ticks per yield).
    await Promise.resolve()
    // Yield a single `joined` event then stop.
    const initial = (input as { initialPresence?: Record<string, unknown> }).initialPresence ?? {}
    yield {
      type: 'joined',
      connectionId: 'stub-conn',
      presence: initial,
    } as never
    // Yield join of another client.
    yield {
      type: 'joined',
      connectionId: 'other',
      presence: { name: 'other' },
    } as never
  },
}

function RoomConsumer(): React.ReactElement {
  const room = useRoom()
  return (
    <div>
      <span data-testid="roomId">{room.roomId}</span>
      <span data-testid="connectionId">{room.connectionId ?? 'null'}</span>
      <span data-testid="myPresenceJSON">{JSON.stringify(room.myPresence)}</span>
    </div>
  )
}

function OthersConsumer(): React.ReactElement {
  const others = useOthers()
  return <span data-testid="othersJSON">{JSON.stringify(others)}</span>
}

function UpdaterConsumer(): React.ReactElement {
  const update = useUpdateMyPresence()
  const presence = usePresence()
  return (
    <div>
      <span data-testid="presenceJSON">{JSON.stringify(presence)}</span>
      <button type="button" data-testid="update-btn" onClick={() => update({ cursor: [5, 5] })}>
        update
      </button>
    </div>
  )
}

describe('React hooks', () => {
  it('RoomProvider mounts + useRoom reflects roomId', async () => {
    const { getByTestId } = render(
      <RoomProvider roomId="cursor" client={stubClient}>
        <RoomConsumer />
      </RoomProvider>,
    )
    await waitFor(() => {
      expect(getByTestId('connectionId').textContent).toBe('stub-conn')
    })
    expect(getByTestId('roomId').textContent).toBe('cursor')
  })

  it('useOthers reflects other connections joining', async () => {
    const { getByTestId } = render(
      <RoomProvider roomId="cursor" client={stubClient}>
        <OthersConsumer />
      </RoomProvider>,
    )
    await waitFor(() => {
      const text = getByTestId('othersJSON').textContent ?? '{}'
      expect(text).toContain('other')
    })
  })

  it('useUpdateMyPresence merges locally', async () => {
    const { getByTestId } = render(
      <RoomProvider roomId="cursor" initialPresence={{ name: 'alice' }} client={stubClient}>
        <UpdaterConsumer />
      </RoomProvider>,
    )
    await waitFor(() => {
      // After the stub yields `joined`, presence comes from the stub's data.
      const txt = getByTestId('presenceJSON').textContent ?? '{}'
      expect(txt).toContain('alice')
    })
    act(() => {
      ;(getByTestId('update-btn') as HTMLButtonElement).click()
    })
    await waitFor(() => {
      expect(getByTestId('presenceJSON').textContent).toContain('cursor')
    })
  })

  it('useRoom throws when used outside RoomProvider', () => {
    function BadConsumer(): React.ReactElement {
      useRoom()
      return <div />
    }
    // Suppress React's console.error noise for this expected-throw test.
    const origError = console.error
    console.error = () => {
      /* intentionally empty — suppress React's expected error boundary noise */
    }
    try {
      expect(() => render(<BadConsumer />)).toThrow(/RoomProvider/)
    } finally {
      console.error = origError
    }
  })
})
