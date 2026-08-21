/**
 * @theokit/plugin-copilot/react — Copilot React Context (P#11).
 *
 * @public
 */

import * as React from 'react'
import { COPILOT_CONNECTION_PREFIX } from '../agent-room-member.js'

/**
 * Copilot message shape exposed to hooks/components.
 *
 * @public
 */
export interface CopilotMessage {
  readonly id: string
  /** `assistant` for copilot replies; `user` for human broadcasts. */
  readonly role: 'assistant' | 'user'
  readonly text: string
  readonly senderId: string
  readonly senderName?: string
  readonly copilotId?: string
  readonly ts: number
}

/**
 * Per-presence snapshot exposed via useCopilotPresence.
 *
 * @public
 */
export interface CopilotPresenceEntry {
  readonly connectionId: string
  readonly name?: string
  readonly avatar?: string
  readonly color?: string
  readonly typing?: boolean
  readonly progress?: number
  readonly isCopilot: boolean
}

/**
 * State exposed via the React Context.
 *
 * @public
 */
export interface CopilotContextValue {
  /** Copilot id this context is bound to (matches defineCopilot id). */
  readonly copilotId: string
  /** Room id (P#9 room descriptor's id). */
  readonly roomId: string
  /** Recent messages (capped via cap option; newest last). */
  readonly messages: readonly CopilotMessage[]
  /** Current presence snapshot (all room participants — copilots + humans). */
  readonly presence: Readonly<Record<string, CopilotPresenceEntry>>
  /** True when at least one copilot is currently emitting (typing indicator). */
  readonly isAnyCopilotTyping: boolean
  /** Budget usage snapshot (theo-ui usage-meter integration). */
  readonly usage?: { dailyUsedUsd: number; monthlyUsedUsd: number }
  /** Send a user broadcast (typically "broadcast:question" or similar event). */
  sendBroadcast(event: string, payload: Record<string, unknown>): void
  /** Last error (for displaying agent-error / budget-exceeded frames). */
  readonly lastError?: { code?: string; message: string }
}

/**
 * The React context carrying {@link CopilotContextValue} down the tree.
 *
 * Exported for the rare consumer that needs its own provider — a test harness driving a
 * deterministic copilot, or an app nesting two independent ones. Reading it directly returns `null`
 * outside a provider; prefer the hooks, which turn that into an error naming what is missing.
 *
 * @public
 */
export const CopilotContext = React.createContext<CopilotContextValue | null>(null)

/** Helper — copilot connectionIds use a reserved prefix per ADR D2 / EC-8. */
export function isCopilotConnectionId(connectionId: string): boolean {
  return connectionId.startsWith(COPILOT_CONNECTION_PREFIX)
}
