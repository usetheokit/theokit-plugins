/**
 * @theokit/plugin-copilot — AgentRoomMember (P#11 internal).
 *
 * Per ADR D2 — copilot is a P#9 RoomMember (presence-visible to other users).
 * The moat: CopilotKit doesn't have this.
 *
 * Wraps a single copilot instance per room. Joins via P#9 RealtimeProvider
 * with `connectionId = "copilot:${copilotId}"` prefix (per ADR D2 security guard).
 *
 * @public
 */

import type { CopilotDescriptor, CopilotIdentity, CopilotRealtimeProvider } from './types.js'

/** Prefix used for copilot connectionIds (security guard — humans must not start with this). */
export const COPILOT_CONNECTION_PREFIX = 'copilot:'

/**
 * Joins / leaves the room; updates typing-indicator presence; broadcasts.
 *
 * @public
 */
export class AgentRoomMember {
  readonly connectionId: string
  private joined = false

  constructor(
    readonly copilot: CopilotDescriptor,
    private readonly provider: CopilotRealtimeProvider,
  ) {
    this.connectionId = `${COPILOT_CONNECTION_PREFIX}${copilot.id}`
  }

  /** Initial join (idempotent — second call no-ops). */
  async join(): Promise<void> {
    if (this.joined) return
    const presence = identityToPresence(this.copilot.identity, { typing: false })
    await this.provider.joinRoom(
      this.copilot.room.id,
      { connectionId: this.connectionId },
      presence,
    )
    this.joined = true
  }

  /** Leave the room (idempotent). */
  async leave(): Promise<void> {
    if (!this.joined) return
    this.joined = false
    await this.provider.leaveRoom(this.copilot.room.id, this.connectionId)
  }

  /** Update typing indicator (presence patch). */
  async setTyping(typing: boolean, progress?: number): Promise<void> {
    if (!this.joined) return
    const patch: Record<string, unknown> = { typing }
    if (progress !== undefined) patch.progress = progress
    await this.provider.updatePresence(this.copilot.room.id, this.connectionId, patch)
  }

  /** Broadcast a message event from the copilot. */
  async broadcastMessage(text: string, extra: Record<string, unknown> = {}): Promise<void> {
    if (!this.joined) return
    await this.provider.broadcast(this.copilot.room.id, this.connectionId, 'message', {
      role: 'assistant',
      text,
      copilotId: this.copilot.id,
      ...extra,
    })
  }

  /** Broadcast a custom event from the copilot (e.g. canvas artifact). */
  async broadcastEvent(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.joined) return
    await this.provider.broadcast(this.copilot.room.id, this.connectionId, event, {
      ...payload,
      copilotId: this.copilot.id,
    })
  }

  /** Whether the copilot is currently joined to the room. */
  get isJoined(): boolean {
    return this.joined
  }
}

function identityToPresence(
  identity: CopilotIdentity,
  initial: Record<string, unknown>,
): Record<string, unknown> {
  const presence: Record<string, unknown> = { name: identity.name, ...initial }
  if (identity.avatar !== undefined) presence.avatar = identity.avatar
  if (identity.color !== undefined) presence.color = identity.color
  if (identity.metadata !== undefined) presence.metadata = identity.metadata
  presence.isCopilot = true
  return presence
}
