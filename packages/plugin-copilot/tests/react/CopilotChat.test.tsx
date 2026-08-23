/**
 * @vitest-environment jsdom
 *
 * `<CopilotChat />` — the component a consumer renders.
 *
 * It was at 0% coverage in every metric: lines 48-108, the whole thing, never executed by any
 * test. It is exported from the `./react` subpath and it is what a user of this package actually
 * looks at, so nothing about it was protected — not the composer, not the error banner, not the
 * live region that announces new messages.
 *
 * The context is supplied through `CopilotContext.Provider` directly, which its own docblock
 * names as the supported path for "a test harness driving a deterministic copilot". That keeps
 * these tests about the COMPONENT rather than about the provider's realtime plumbing, which
 * `copilot-room-multi-user.test.ts` already covers.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CopilotChat } from '../../src/react/CopilotChat.js'
import {
  CopilotContext,
  type CopilotContextValue,
  type CopilotMessage,
} from '../../src/react/copilot-context.js'

function ctx(over: Partial<CopilotContextValue> = {}): CopilotContextValue {
  return {
    copilotId: 'support-bot',
    roomId: 'room-1',
    messages: [],
    presence: {},
    isAnyCopilotTyping: false,
    sendBroadcast: vi.fn(),
    ...over,
  }
}

function mount(value: CopilotContextValue, children?: ReactNode): void {
  render(
    <CopilotContext.Provider value={value}>{children ?? <CopilotChat />}</CopilotContext.Provider>,
  )
}

/** The participants header, as an element the testing-library queries can scope to. */
function participants(): HTMLElement {
  return document.querySelector('[data-section="copilot-participants"]') as HTMLElement
}

const message = (over: Partial<CopilotMessage> = {}): CopilotMessage =>
  ({
    id: 'm1',
    role: 'user',
    text: 'hello',
    ...over,
  }) as CopilotMessage

describe('<CopilotChat /> messages', () => {
  it('says so when there is nothing to show', () => {
    mount(ctx())
    expect(screen.getByText('No messages yet.')).toBeTruthy()
  })

  it('announces new messages through a live region', () => {
    // A chat transcript that updates without `aria-live` is invisible to a screen reader:
    // the reply arrives and nothing tells the user it did.
    mount(ctx({ messages: [message({ text: 'hi there' })] }))
    const main = document.querySelector('[data-section="copilot-messages"]')
    expect(main?.getAttribute('aria-live')).toBe('polite')
    expect(within(main as HTMLElement).getByText(/hi there/)).toBeTruthy()
  })

  it('labels an assistant message AI and a user message User when no name is given', () => {
    mount(
      ctx({
        messages: [
          message({ id: 'a', role: 'assistant', text: 'from the bot' }),
          message({ id: 'b', role: 'user', text: 'from a person' }),
        ],
      }),
    )
    expect(screen.getByText('AI:')).toBeTruthy()
    expect(screen.getByText('User:')).toBeTruthy()
  })

  it('prefers the sender name when the message carries one', () => {
    mount(ctx({ messages: [message({ senderName: 'Ada' })] }))
    expect(screen.getByText('Ada:')).toBeTruthy()
  })
})

describe('<CopilotChat /> composer', () => {
  it('refuses to send an empty draft', () => {
    const sendBroadcast = vi.fn()
    mount(ctx({ sendBroadcast }))

    const button = screen.getByRole('button', { name: 'Send' })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.submit(button.closest('form') as HTMLFormElement)
    expect(sendBroadcast).not.toHaveBeenCalled()
  })

  it('refuses whitespace, which the disabled button alone would not stop', () => {
    // The button is disabled on a blank draft, but a form submits on Enter too. The guard in
    // `handleSubmit` is the one that has to hold.
    const sendBroadcast = vi.fn()
    mount(ctx({ sendBroadcast }))

    fireEvent.change(screen.getByLabelText('Copilot input'), { target: { value: '   ' } })
    fireEvent.submit(screen.getByLabelText('Copilot input').closest('form') as HTMLFormElement)
    expect(sendBroadcast).not.toHaveBeenCalled()
  })

  it('broadcasts the trimmed text and clears the draft', () => {
    const sendBroadcast = vi.fn()
    mount(ctx({ sendBroadcast }))

    const input = screen.getByLabelText('Copilot input')
    fireEvent.change(input, { target: { value: '  what is the SLA?  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(sendBroadcast).toHaveBeenCalledWith('question', { text: 'what is the SLA?' })
    expect(input).toHaveProperty('value', '')
  })

  it('uses the event name the consumer asked for', () => {
    const sendBroadcast = vi.fn()
    render(
      <CopilotContext.Provider value={ctx({ sendBroadcast })}>
        <CopilotChat inputEvent="ask" />
      </CopilotContext.Provider>,
    )
    fireEvent.change(screen.getByLabelText('Copilot input'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(sendBroadcast).toHaveBeenCalledWith('ask', { text: 'hi' })
  })
})

describe('<CopilotChat /> status', () => {
  it('shows the typing indicator only while a copilot is emitting', () => {
    mount(ctx({ isAnyCopilotTyping: false }))
    expect(document.querySelector('[data-section="copilot-typing-indicator"]')).toBeNull()
  })

  it('announces an error as an alert, with its code when there is one', () => {
    mount(ctx({ lastError: { code: 'BUDGET_EXCEEDED', message: 'Daily budget spent' } }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('[BUDGET_EXCEEDED]')
    expect(alert.textContent).toContain('Daily budget spent')
  })

  it('announces an error with no code without an empty bracket', () => {
    mount(ctx({ lastError: { message: 'Something broke' } }))
    expect(screen.getByRole('alert').textContent?.trim()).toBe('Something broke')
  })
})

describe('<CopilotChat /> participants', () => {
  it('lists the other participants in the room', () => {
    mount(
      ctx({
        presence: {
          'copilot:support-bot': {
            connectionId: 'copilot:support-bot',
            name: 'Bot',
            isCopilot: true,
          },
          'user-2': { connectionId: 'user-2', name: 'Grace', isCopilot: false },
        },
      }),
    )
    const header = document.querySelector('[data-section="copilot-participants"]')
    expect(within(header as HTMLElement).getByText(/Bot/)).toBeTruthy()
    expect(within(header as HTMLElement).getByText(/Grace/)).toBeTruthy()
  })

  it('marks which participants are copilots', () => {
    mount(
      ctx({
        presence: {
          'copilot:support-bot': {
            connectionId: 'copilot:support-bot',
            name: 'Bot',
            isCopilot: true,
          },
          'user-2': { connectionId: 'user-2', name: 'Grace', isCopilot: false },
        },
      }),
    )
    const flags = within(participants())
      .getAllByRole('listitem')
      .map((li) => `${li.textContent?.trim()}=${li.getAttribute('data-copilot')}`)
    expect(flags.sort()).toEqual(['Bot=true', 'Grace=false'])
  })

  it('leaves the local user out of the list, when the context says who that is', () => {
    // `otherPresence` used to be the whole room: the user saw themselves listed as a
    // participant beside the bot. The context now carries `userConnectionId` so the component
    // can tell itself apart (#114).
    mount(
      ctx({
        userConnectionId: 'user-1',
        presence: {
          'user-1': { connectionId: 'user-1', name: 'Me', isCopilot: false },
          'user-2': { connectionId: 'user-2', name: 'Grace', isCopilot: false },
        },
      }),
    )
    const names = within(participants())
      .getAllByRole('listitem')
      .map((li) => li.textContent?.trim())
    expect(names).toEqual(['Grace'])
  })

  it('still lists everyone when the context does not say who the local user is', () => {
    // The hand-built provider the CopilotContext docblock blesses omits the field, and that
    // path must keep working — which is why `userConnectionId` is optional rather than required.
    mount(
      ctx({
        presence: {
          'user-1': { connectionId: 'user-1', name: 'Me', isCopilot: false },
          'user-2': { connectionId: 'user-2', name: 'Grace', isCopilot: false },
        },
      }),
    )
    const names = within(participants())
      .getAllByRole('listitem')
      .map((li) => li.textContent?.trim())
    expect(names.sort()).toEqual(['Grace', 'Me'])
  })
})

describe('<CopilotChat /> render overrides', () => {
  // The three escape hatches this component ships for theming. Each replaces a default the
  // tests above pin, so a broken override is invisible unless the override itself is exercised.

  it('lets the consumer render messages', () => {
    render(
      <CopilotContext.Provider value={ctx({ messages: [message({ text: 'raw' })] })}>
        <CopilotChat renderMessage={(m) => <blockquote>custom: {m.text}</blockquote>} />
      </CopilotContext.Provider>,
    )
    expect(screen.getByText(/custom: raw/)).toBeTruthy()
    expect(screen.queryByText('User:'), 'the default bubble should be replaced').toBeNull()
  })

  it('lets the consumer render the participant list', () => {
    render(
      <CopilotContext.Provider
        value={ctx({
          presence: {
            'user-2': { connectionId: 'user-2', name: 'Grace', isCopilot: false },
          },
        })}
      >
        <CopilotChat renderParticipants={(p) => <span>{Object.keys(p).length} here</span>} />
      </CopilotContext.Provider>,
    )
    expect(screen.getByText('1 here')).toBeTruthy()
    expect(document.querySelector('[data-section="copilot-participants"] li')).toBeNull()
  })

  it('lets the consumer render the typing indicator, and tells it whether anyone is typing', () => {
    render(
      <CopilotContext.Provider value={ctx({ isAnyCopilotTyping: true })}>
        <CopilotChat renderTyping={(any) => <em>{any ? 'thinking' : 'idle'}</em>} />
      </CopilotContext.Provider>,
    )
    expect(screen.getByText('thinking')).toBeTruthy()
    expect(document.querySelector('[data-section="copilot-typing-indicator"]')).toBeNull()
  })

  it('shows the default typing indicator while a copilot is emitting', () => {
    mount(ctx({ isAnyCopilotTyping: true }))
    expect(screen.getByText('AI is typing…')).toBeTruthy()
  })

  it('shows the usage line when the context carries a budget snapshot', () => {
    mount(ctx({ usage: { dailyUsedUsd: 0.0123, monthlyUsedUsd: 1.5 } }))
    const usage = document.querySelector('[data-section="copilot-usage"]')
    expect(usage?.textContent).toContain('$0.0123')
    expect(usage?.textContent).toContain('$1.5000')
  })

  it('uses the placeholder and className the consumer asked for', () => {
    const { container } = render(
      <CopilotContext.Provider value={ctx()}>
        <CopilotChat placeholder="Ask away" className="my-chat" />
      </CopilotContext.Provider>,
    )
    expect(screen.getByLabelText('Copilot input').getAttribute('placeholder')).toBe('Ask away')
    expect(container.querySelector('section')?.getAttribute('class')).toBe('my-chat')
  })
})

describe('<CopilotChat /> participant labels', () => {
  it('falls back to the connectionId when a participant has no name', () => {
    // Presence arrives from the wire and `name` is optional there. Rendering an empty <li>
    // would leave a nameless row nobody can identify.
    mount(
      ctx({
        presence: {
          'user-7': { connectionId: 'user-7', isCopilot: false },
        },
      }),
    )
    expect(screen.getByText('user-7')).toBeTruthy()
  })

  it('marks the individual participant who is typing', () => {
    // Distinct from the global indicator below the transcript: this says WHO, and only fires
    // on a literal `true` — an absent flag must not read as typing.
    mount(
      ctx({
        presence: {
          'user-2': { connectionId: 'user-2', name: 'Grace', isCopilot: false, typing: true },
          'user-3': { connectionId: 'user-3', name: 'Alan', isCopilot: false },
        },
      }),
    )
    const rows = within(participants())
      .getAllByRole('listitem')
      .map((li) => li.textContent?.trim())
    expect(rows.sort()).toEqual(['Alan', 'Grace · typing…'])
  })
})
