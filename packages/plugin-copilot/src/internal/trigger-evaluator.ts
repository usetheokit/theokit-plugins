/**
 * @theokit/plugin-copilot — Trigger evaluator (P#11 internal).
 *
 * Per ADR D3 — declarative reactive model. Maps P#9 RealtimeFrame to
 * matching triggers. Per ADR D2 — filters out frames originating from
 * copilots themselves (own connectionId) to prevent cost runaway (EC-4).
 *
 * @internal
 */

import type { CopilotFrame, CopilotTrigger } from '../types.js'
import { COPILOT_CONNECTION_PREFIX } from '../agent-room-member.js'

/**
 * Result of evaluating triggers against a single frame.
 *
 * @internal
 */
export interface TriggerMatch {
  readonly trigger: CopilotTrigger
  readonly frame: CopilotFrame
}

/**
 * Last presence-changed timestamp per connection (for `presence:idle` triggers).
 * Stored as Map<roomId, Map<connectionId, timestamp>>.
 *
 * @internal
 */
export class TriggerEvaluator {
  private readonly idleTrackers = new Map<string, Map<string, number>>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()

  /**
   * Evaluate triggers against a single frame. Filters out copilot-originated
   * frames (EC-4 cost runaway prevention).
   */
  evaluate(
    triggers: readonly CopilotTrigger[],
    frame: CopilotFrame,
    roomId: string,
  ): TriggerMatch[] {
    // EC-4 + EC-8: ignore copilot connections (no self-trigger; no impersonation).
    if (
      'connectionId' in frame &&
      typeof frame.connectionId === 'string' &&
      frame.connectionId.startsWith(COPILOT_CONNECTION_PREFIX)
    ) {
      return []
    }

    // Track presence updates for idle detection.
    if (frame.type === 'presence-changed' || frame.type === 'joined') {
      const roomTracker = this.idleTrackers.get(roomId) ?? new Map<string, number>()
      roomTracker.set(frame.connectionId, Date.now())
      this.idleTrackers.set(roomId, roomTracker)
    }
    if (frame.type === 'left') {
      const roomTracker = this.idleTrackers.get(roomId)
      roomTracker?.delete(frame.connectionId)
    }

    const matches: TriggerMatch[] = []
    for (const trigger of triggers) {
      if (matchesTrigger(trigger, frame)) {
        matches.push({ trigger, frame })
      }
    }
    return matches
  }

  /**
   * Schedule a `presence:idle` check for the room. Returns a stop fn.
   *
   * @internal
   */
  scheduleIdleCheck(
    roomId: string,
    trigger: Extract<CopilotTrigger, { on: 'presence:idle' }>,
    onIdle: () => void,
  ): () => void {
    const existingTimer = this.idleTimers.get(roomId)
    if (existingTimer !== undefined) clearTimeout(existingTimer)

    const check = (): void => {
      const tracker = this.idleTrackers.get(roomId)
      if (tracker === undefined || tracker.size === 0) {
        // No tracked clients; reschedule.
        this.idleTimers.set(roomId, setTimeout(check, trigger.idleMs))
        return
      }
      const now = Date.now()
      let anyActive = false
      for (const lastSeen of tracker.values()) {
        if (now - lastSeen < trigger.idleMs) {
          anyActive = true
          break
        }
      }
      if (!anyActive) {
        onIdle()
      }
      this.idleTimers.set(roomId, setTimeout(check, trigger.idleMs))
    }

    this.idleTimers.set(roomId, setTimeout(check, trigger.idleMs))
    return () => {
      const t = this.idleTimers.get(roomId)
      if (t !== undefined) {
        clearTimeout(t)
        this.idleTimers.delete(roomId)
      }
    }
  }

  /** Clear tracking state for a room (called when copilot leaves). */
  clearRoom(roomId: string): void {
    this.idleTrackers.delete(roomId)
    const t = this.idleTimers.get(roomId)
    if (t !== undefined) {
      clearTimeout(t)
      this.idleTimers.delete(roomId)
    }
  }
}

function matchesTrigger(trigger: CopilotTrigger, frame: CopilotFrame): boolean {
  if (trigger.on === 'custom') {
    return trigger.filter(frame)
  }
  if (trigger.on === 'presence:idle') {
    // Idle triggers are handled via scheduleIdleCheck — never matched by individual frames.
    return false
  }
  if (trigger.on.startsWith('broadcast:') && frame.type === 'broadcast') {
    const eventName = trigger.on.slice('broadcast:'.length)
    return frame.event === eventName
  }
  return false
}
