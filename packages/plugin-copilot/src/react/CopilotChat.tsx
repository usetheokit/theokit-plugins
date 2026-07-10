/**
 * @theokit/plugin-copilot/react — `<CopilotChat />` component (P#11).
 *
 * Per ADR D5 — composição de theo-ui composites (chat-message + chat-composer
 * + agent-stream + agent-timeline + usage-meter). ZERO custom CSS.
 *
 * v0.1 ships a headless reference layout — consumer can theme via
 * className overrides + injected children. theo-ui composite integration
 * uses dynamic import to avoid hard peer (consumer installs @theokit/ui
 * only if rendering this component).
 *
 * @public
 */

import * as React from 'react'
import { useCopilot, useCopilotPresence, useCopilotTyping } from './hooks.js'
import type { CopilotMessage, CopilotPresenceEntry } from './copilot-context.js'

/**
 * Props for {@link CopilotChat}.
 *
 * @public
 */
export interface CopilotChatProps {
  /** Broadcast event name used by the local user's input (default `"question"`). */
  inputEvent?: string
  /** Placeholder text for the composer. */
  placeholder?: string
  /** Optional className passed to the root container. */
  className?: string
  /** Render override for individual messages (defaults to a basic bubble). */
  renderMessage?: (msg: CopilotMessage) => React.ReactNode
  /** Render override for the participant list (defaults to inline pills). */
  renderParticipants?: (presence: Record<string, CopilotPresenceEntry>) => React.ReactNode
  /** Render override for the typing indicator. */
  renderTyping?: (anyTyping: boolean) => React.ReactNode
}

/**
 * Headless copilot chat layout. Composes hooks + minimal markup. theo-ui
 * composites are dynamically imported when available (consumer can opt-in
 * by installing @theokit/ui and providing renderMessage/renderTyping that
 * use theo-ui chat-message / agent-stream).
 *
 * @public
 */
export function CopilotChat(props: CopilotChatProps = {}): React.ReactElement {
  const ctx = useCopilot()
  const otherPresence = useCopilotPresence()
  const anyTyping = useCopilotTyping()
  const [draft, setDraft] = React.useState('')

  const inputEvent = props.inputEvent ?? 'question'

  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const text = draft.trim()
      if (text.length === 0) return
      ctx.sendBroadcast(inputEvent, { text })
      setDraft('')
    },
    [ctx, inputEvent, draft],
  )

  return (
    <section className={props.className ?? 'theokit-copilot-chat'} data-copilot-id={ctx.copilotId}>
      <header data-section="copilot-participants">
        {props.renderParticipants !== undefined ? (
          props.renderParticipants(otherPresence)
        ) : (
          <ul>
            {Object.entries(otherPresence).map(([id, p]) => (
              <li key={id} data-copilot={p.isCopilot ? 'true' : 'false'}>
                {p.name ?? id}
                {p.typing === true ? ' · typing…' : ''}
              </li>
            ))}
          </ul>
        )}
      </header>
      <main data-section="copilot-messages" aria-live="polite">
        {ctx.messages.length === 0 ? (
          <p data-empty="true">No messages yet.</p>
        ) : (
          ctx.messages.map((msg) =>
            props.renderMessage !== undefined ? (
              <React.Fragment key={msg.id}>{props.renderMessage(msg)}</React.Fragment>
            ) : (
              <article key={msg.id} data-role={msg.role}>
                <strong>{msg.senderName ?? (msg.role === 'assistant' ? 'AI' : 'User')}:</strong>{' '}
                {msg.text}
              </article>
            ),
          )
        )}
        {props.renderTyping !== undefined ? (
          props.renderTyping(anyTyping)
        ) : anyTyping ? (
          <p data-section="copilot-typing-indicator">AI is typing…</p>
        ) : null}
      </main>
      <footer data-section="copilot-composer">
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={props.placeholder ?? 'Ask the copilot…'}
            aria-label="Copilot input"
          />
          <button type="submit" disabled={draft.trim().length === 0}>
            Send
          </button>
        </form>
        {ctx.lastError !== undefined ? (
          <p data-section="copilot-error" role="alert">
            {ctx.lastError.code !== undefined ? `[${ctx.lastError.code}] ` : ''}
            {ctx.lastError.message}
          </p>
        ) : null}
        {ctx.usage !== undefined ? (
          <p data-section="copilot-usage">
            Used today: ${ctx.usage.dailyUsedUsd.toFixed(4)} · this month: $
            {ctx.usage.monthlyUsedUsd.toFixed(4)}
          </p>
        ) : null}
      </footer>
    </section>
  )
}
