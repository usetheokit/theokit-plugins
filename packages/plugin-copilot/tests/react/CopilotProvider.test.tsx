/**
 * @vitest-environment jsdom
 *
 * `<CopilotProvider />` — the frames a room sends, turned into what the UI reads.
 *
 * The provider was at 41.93% statements and 9.61% branches: `handleFrame`, which is the whole
 * translation from wire frames to messages and presence, was almost entirely unexecuted. It is
 * where a copilot's reply becomes a message, where an error frame becomes the banner a user
 * sees, and where the message cap decides what is forgotten.
 *
 * Driven through the real component with a controllable provider, so the assertions are about
 * what a consumer's tree receives — not about a reducer called in isolation. The subscriber
 * callback is captured from `subscribeRoom`, which is how the room would reach it.
 */

import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CopilotProvider } from '../../src/react/copilot-provider.js'
import { useCopilot } from '../../src/react/hooks.js'
import type { CopilotRealtimeProvider } from '../../src/types.js'

/** A copilot connectionId per ADR D2 — the prefix is what marks a sender as the assistant. */
const BOT = 'copilot:support'
const HUMAN = 'user-2'

interface Harness {
  readonly provider: CopilotRealtimeProvider
  /** Push a frame the way the room would. */
  emit: (frame: unknown) => void
  readonly unsubscribe: ReturnType<typeof vi.fn>
  readonly broadcast: ReturnType<typeof vi.fn>
}

function harness(initialPresence: Record<string, Record<string, unknown>> = {}): Harness {
  let sink: ((frame: unknown) => void) | undefined
  const unsubscribe = vi.fn()
  const broadcast = vi.fn().mockResolvedValue(undefined)
  const provider = {
    joinRoom: vi.fn().mockResolvedValue(undefined),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    broadcast,
    updatePresence: vi.fn().mockResolvedValue(undefined),
    getPresence: () => Promise.resolve(initialPresence),
    subscribeRoom: (_room: string, cb: (frame: unknown) => void) => {
      sink = cb
      return unsubscribe
    },
  } as unknown as CopilotRealtimeProvider

  return {
    provider,
    unsubscribe,
    broadcast,
    emit: (frame) => {
      act(() => sink?.(frame))
    },
  }
}

/** Renders the context as text, so assertions read what a consumer component would see. */
function Probe(): React.JSX.Element {
  const ctx = useCopilot()
  return (
    <>
      <p data-t="messages">
        {ctx.messages
          .map((m) => `${m.role}:${m.text}${m.senderName ? `(${m.senderName})` : ''}`)
          .join('|')}
      </p>
      <p data-t="presence">{Object.keys(ctx.presence).sort().join(',')}</p>
      <p data-t="typing">{ctx.isAnyCopilotTyping ? 'yes' : 'no'}</p>
      <p data-t="error">{ctx.lastError ? `${ctx.lastError.code}/${ctx.lastError.message}` : ''}</p>
    </>
  )
}

function read(name: string): string {
  return document.querySelector(`[data-t="${name}"]`)?.textContent ?? ''
}

function mount(h: Harness, messageCap?: number): ReturnType<typeof render> {
  return render(
    <CopilotProvider
      copilotId="support"
      roomId="room-1"
      provider={h.provider}
      userConnectionId="user-1"
      {...(messageCap === undefined ? {} : { messageCap })}
    >
      <Probe />
    </CopilotProvider>,
  )
}

describe('CopilotProvider presence', () => {
  it('takes the initial snapshot from the room', async () => {
    mount(harness({ [HUMAN]: { name: 'Grace' } }))
    await waitFor(() => expect(read('presence')).toBe(HUMAN))
  })

  it('adds a participant on joined and drops them on left', async () => {
    const h = harness()
    mount(h)
    await waitFor(() => expect(read('presence')).toBe(''))

    h.emit({ type: 'joined', connectionId: HUMAN, presence: { name: 'Grace' } })
    expect(read('presence')).toBe(HUMAN)

    h.emit({ type: 'left', connectionId: HUMAN })
    expect(read('presence')).toBe('')
  })

  it('reports a copilot as typing only while its presence says so', () => {
    const h = harness()
    mount(h)
    h.emit({ type: 'joined', connectionId: BOT, presence: { name: 'Bot', typing: false } })
    expect(read('typing')).toBe('no')

    h.emit({ type: 'presence-changed', connectionId: BOT, presence: { name: 'Bot', typing: true } })
    expect(read('typing')).toBe('yes')
  })

  it('does not report a HUMAN typing as a copilot typing', () => {
    // The indicator says "AI is typing"; a person typing must not trigger it.
    const h = harness()
    mount(h)
    h.emit({ type: 'joined', connectionId: HUMAN, presence: { name: 'Grace', typing: true } })
    expect(read('typing')).toBe('no')
  })
})

describe('CopilotProvider messages', () => {
  it('marks a message from a copilot connectionId as the assistant', () => {
    const h = harness()
    mount(h)
    h.emit({ type: 'broadcast', connectionId: BOT, event: 'message', payload: { text: 'hi' } })
    expect(read('messages')).toBe('assistant:hi')
  })

  it('marks a message from anyone else as a user', () => {
    const h = harness()
    mount(h)
    h.emit({ type: 'broadcast', connectionId: HUMAN, event: 'question', payload: { text: 'why?' } })
    expect(read('messages')).toBe('user:why?')
  })

  it('keeps the sender name when the payload carries one', () => {
    const h = harness()
    mount(h)
    h.emit({
      type: 'broadcast',
      connectionId: HUMAN,
      event: 'message',
      payload: { text: 'hi', senderName: 'Grace' },
    })
    expect(read('messages')).toBe('user:hi(Grace)')
  })

  it('ignores a message frame with no text', () => {
    // An empty bubble is worse than no bubble: it looks like a reply that failed to render.
    const h = harness()
    mount(h)
    h.emit({ type: 'broadcast', connectionId: BOT, event: 'message', payload: { text: '' } })
    h.emit({ type: 'broadcast', connectionId: BOT, event: 'message', payload: {} })
    expect(read('messages')).toBe('')
  })

  it('ignores a broadcast event it does not handle', () => {
    const h = harness()
    mount(h)
    h.emit({
      type: 'broadcast',
      connectionId: BOT,
      event: 'register-knowledge',
      payload: { text: 'x' },
    })
    expect(read('messages')).toBe('')
  })

  it('forgets the oldest message once the cap is reached', () => {
    // Off-by-one here silently drops a message the user sent, or grows without bound.
    const h = harness()
    mount(h, 2)
    for (const text of ['one', 'two', 'three']) {
      h.emit({ type: 'broadcast', connectionId: HUMAN, event: 'message', payload: { text } })
    }
    expect(read('messages')).toBe('user:two|user:three')
  })

  it('keeps every message while under the cap', () => {
    const h = harness()
    mount(h, 3)
    for (const text of ['one', 'two']) {
      h.emit({ type: 'broadcast', connectionId: HUMAN, event: 'message', payload: { text } })
    }
    expect(read('messages')).toBe('user:one|user:two')
  })
})

describe('CopilotProvider errors', () => {
  it('surfaces an agent error with the code the payload carries', () => {
    const h = harness()
    mount(h)
    h.emit({
      type: 'broadcast',
      connectionId: BOT,
      event: 'agent-error',
      payload: { code: 'RATE_LIMIT', message: 'Too many requests' },
    })
    expect(read('error')).toBe('RATE_LIMIT/Too many requests')
  })

  it('falls back to the event name and a stated message when the payload says nothing', () => {
    // A frame that arrives malformed still has to produce something a user can act on, rather
    // than an undefined banner.
    const h = harness()
    mount(h)
    h.emit({ type: 'broadcast', connectionId: BOT, event: 'budget-exceeded', payload: {} })
    expect(read('error')).toBe('budget-exceeded/Copilot budget-exceeded')
  })

  it('does not record an error frame as a chat message', () => {
    const h = harness()
    mount(h)
    h.emit({
      type: 'broadcast',
      connectionId: BOT,
      event: 'agent-error',
      payload: { message: 'boom' },
    })
    expect(read('messages')).toBe('')
  })
})

describe('CopilotProvider lifecycle', () => {
  it('unsubscribes from the room when it unmounts', () => {
    const h = harness()
    const { unmount } = mount(h)
    unmount()
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('broadcasts as the local user', () => {
    const h = harness()
    render(
      <CopilotProvider
        copilotId="support"
        roomId="room-1"
        provider={h.provider}
        userConnectionId="user-1"
      >
        <Sender />
      </CopilotProvider>,
    )
    expect(h.broadcast).toHaveBeenCalledWith('room-1', 'user-1', 'question', { text: 'hi' })
  })
})

describe('CopilotProvider wire fields', () => {
  it('carries every optional presence field the room sent', () => {
    // The provider's job is to hand the room's data to the UI. Each of these is a separate
    // conditional spread, so dropping one is invisible — the participant simply renders
    // without an avatar, or without the progress bar, and nothing fails.
    const h = harness()
    render(
      <CopilotProvider
        copilotId="support"
        roomId="room-1"
        provider={h.provider}
        userConnectionId="user-1"
      >
        <PresenceProbe />
      </CopilotProvider>,
    )
    h.emit({
      type: 'joined',
      connectionId: BOT,
      presence: { name: 'Bot', avatar: 'a.png', color: '#0f0', typing: true, progress: 0.5 },
    })

    expect(read('fields')).toBe('name=Bot avatar=a.png color=#0f0 typing=true progress=0.5')
  })

  it('drops a presence field the room sent with the wrong type', () => {
    // Frames arrive from the wire; `progress: "half"` must not reach a component expecting a
    // number. The mapping is type-checked at runtime precisely because the type is a promise
    // about a value nobody here produced.
    const h = harness()
    render(
      <CopilotProvider
        copilotId="support"
        roomId="room-1"
        provider={h.provider}
        userConnectionId="user-1"
      >
        <PresenceProbe />
      </CopilotProvider>,
    )
    h.emit({
      type: 'joined',
      connectionId: BOT,
      presence: { name: 42, avatar: null, progress: 'half' },
    })

    expect(read('fields')).toBe('name=- avatar=- color=- typing=- progress=-')
  })

  it('keeps the copilotId a message was attributed to', () => {
    const h = harness()
    render(
      <CopilotProvider
        copilotId="support"
        roomId="room-1"
        provider={h.provider}
        userConnectionId="user-1"
      >
        <MessageProbe />
      </CopilotProvider>,
    )
    h.emit({
      type: 'broadcast',
      connectionId: BOT,
      event: 'message',
      payload: { text: 'hi', copilotId: 'support' },
    })

    expect(read('copilotId')).toBe('support')
  })
})

describe('CopilotProvider budget + guards', () => {
  it('publishes the usage snapshot the consumer supplied', () => {
    const h = harness()
    render(
      <CopilotProvider
        copilotId="support"
        roomId="room-1"
        provider={h.provider}
        userConnectionId="user-1"
        usage={() => ({ dailyUsedUsd: 0.25, monthlyUsedUsd: 3 })}
      >
        <UsageProbe />
      </CopilotProvider>,
    )
    expect(read('usage')).toBe('0.25/3')
  })

  it('leaves usage undefined when the consumer supplies no poll fn', () => {
    const h = harness()
    render(
      <CopilotProvider
        copilotId="support"
        roomId="room-1"
        provider={h.provider}
        userConnectionId="user-1"
      >
        <UsageProbe />
      </CopilotProvider>,
    )
    expect(read('usage')).toBe('none')
  })

  it('ignores a frame that arrives after unmount', () => {
    // The provider unsubscribes on cleanup, so a well-behaved room stops sending. The
    // `cancelled` guard is for one that does not.
    //
    // Honest about what this proves: React 19 makes a state update on an unmounted component a
    // silent no-op, so the guard's observable effect here is that the late frame is not
    // processed and nothing throws. It pins the intent and executes the branch; it cannot
    // demonstrate a warning that React no longer emits.
    const h = harness()
    const { unmount } = mount(h)
    unmount()

    expect(() =>
      h.emit({ type: 'broadcast', connectionId: BOT, event: 'message', payload: { text: 'late' } }),
    ).not.toThrow()
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('copilot hooks outside a provider', () => {
  it('refuse by name, so the missing wrapper is the thing the error says', () => {
    // `useContext` returns null outside a provider, and returning an empty context here would
    // let a chat render blank and bind to nothing.
    function Orphan(): React.JSX.Element {
      useCopilot()
      return <p>unreachable</p>
    }
    expect(() => render(<Orphan />)).toThrow(/must be called inside <CopilotProvider>/)
  })
})

function UsageProbe(): React.JSX.Element {
  const { usage } = useCopilot()
  return <p data-t="usage">{usage ? `${usage.dailyUsedUsd}/${usage.monthlyUsedUsd}` : 'none'}</p>
}

function PresenceProbe(): React.JSX.Element {
  const p = useCopilot().presence[BOT]
  return (
    <p data-t="fields">
      {`name=${p?.name ?? '-'} avatar=${p?.avatar ?? '-'} color=${p?.color ?? '-'} ` +
        `typing=${p?.typing ?? '-'} progress=${p?.progress ?? '-'}`}
    </p>
  )
}

function MessageProbe(): React.JSX.Element {
  const [msg] = useCopilot().messages
  return <p data-t="copilotId">{msg?.copilotId ?? ''}</p>
}

function Sender(): React.JSX.Element {
  const ctx = useCopilot()
  ctx.sendBroadcast('question', { text: 'hi' })
  return <p>sent</p>
}
