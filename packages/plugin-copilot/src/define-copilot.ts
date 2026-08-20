/**
 * @theokit/plugin-copilot — `defineCopilot` factory (P#11 public API).
 *
 * Per ADRs D1 (Form 4 Hybrid) + D3 (triggers-based reactive model).
 *
 * @public
 */

import {
  CopilotConfigError,
  type CopilotDescriptor,
  type CopilotDispatcher,
  type CopilotTrigger,
  type CopilotIdentity,
  type CopilotAgentConfig,
  type CopilotBudgetConfig,
  type CopilotCanvasConfig,
  type CopilotRateLimitConfig,
  type CopilotRoomBinding,
  type CopilotVoiceConfig,
} from './types.js'

/**
 * Options accepted by {@link defineCopilot}.
 *
 * @public
 */
export interface DefineCopilotOptions {
  /** Stable copilot identifier (URL-safe, non-empty). Used as `copilot:${id}` connectionId in P#9 room. */
  id: string
  /** P#9 room descriptor — copilot joins this room. */
  room: CopilotRoomBinding
  /** SDK Agent configuration. */
  agent: CopilotAgentConfig
  /** Copilot's room identity (presence-visible name/avatar/color). */
  identity: CopilotIdentity
  /** Declarative triggers (per ADR D3). */
  triggers: readonly CopilotTrigger[]
  /** Optional rate-limit (per-copilot windowed limit). */
  rateLimit?: CopilotRateLimitConfig
  /** Optional Budget integration (SDK Budget D375-D388). */
  budget?: CopilotBudgetConfig
  /** Optional Voice integration (plugin-voice peer required at runtime if set). */
  voice?: CopilotVoiceConfig
  /** Optional Canvas integration (plugin-canvas peer required at runtime if set). */
  canvas?: CopilotCanvasConfig
  /** Optional multi-copilot dispatcher policy (per ADR D6). */
  dispatcher?: CopilotDispatcher
}

const COPILOT_ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/

/** #184: validate object shape, id, and room (throws CopilotConfigError). */
function assertCopilotBaseShape(opts: DefineCopilotOptions): void {
  if (opts === null || typeof opts !== 'object') {
    throw new CopilotConfigError('defineCopilot: options object is required')
  }
  if (typeof opts.id !== 'string' || !COPILOT_ID_RE.test(opts.id)) {
    throw new CopilotConfigError(
      `defineCopilot: opts.id must match /^[a-zA-Z][a-zA-Z0-9_-]*$/ (URL-safe); got ${JSON.stringify(opts.id)}`,
      { code: 'copilot_id_invalid' },
    )
  }
  if (opts.room === undefined || typeof opts.room.id !== 'string' || opts.room.id.length === 0) {
    throw new CopilotConfigError(
      'defineCopilot: opts.room must be a RoomDescriptor with non-empty id',
      { code: 'copilot_room_invalid' },
    )
  }
}

/** #184: validate agent + identity (throws CopilotConfigError). */
function assertCopilotAgentIdentity(opts: DefineCopilotOptions): void {
  if (
    opts.agent === undefined ||
    typeof opts.agent.name !== 'string' ||
    opts.agent.name.length === 0
  ) {
    throw new CopilotConfigError('defineCopilot: opts.agent.name must be non-empty string', {
      code: 'copilot_agent_invalid',
    })
  }
  if (opts.agent.model === undefined) {
    throw new CopilotConfigError('defineCopilot: opts.agent.model is required', {
      code: 'copilot_agent_model_missing',
    })
  }
  if (
    opts.identity === undefined ||
    typeof opts.identity.name !== 'string' ||
    opts.identity.name.length === 0
  ) {
    throw new CopilotConfigError('defineCopilot: opts.identity.name must be non-empty string', {
      code: 'copilot_identity_invalid',
    })
  }
}

/** #184: validate the triggers array + per-trigger requirements. */
function assertCopilotTriggers(triggers: DefineCopilotOptions['triggers']): void {
  if (!Array.isArray(triggers) || triggers.length === 0) {
    throw new CopilotConfigError(
      'defineCopilot: opts.triggers must be a non-empty array (at least one trigger required to activate copilot)',
      { code: 'copilot_triggers_empty' },
    )
  }
  // `Array.isArray` widens the narrowed value to `any[]`; iterate over the
  // originally-typed array so per-trigger member access stays type-safe.
  for (const t of triggers as readonly CopilotTrigger[]) {
    if (t.on === 'custom' && typeof t.filter !== 'function') {
      throw new CopilotConfigError('defineCopilot: custom trigger must include a filter function', {
        code: 'copilot_trigger_filter_missing',
      })
    }
    if (t.on === 'presence:idle' && (typeof t.idleMs !== 'number' || t.idleMs <= 0)) {
      throw new CopilotConfigError('defineCopilot: presence:idle trigger must include idleMs > 0', {
        code: 'copilot_trigger_idle_invalid',
      })
    }
  }
}

/**
 * Define a copilot — pairs a P#9 room with an Agent + reactive triggers.
 *
 * @example
 * ```ts
 * import { defineCopilot } from "@theokit/plugin-copilot";
 * import { defineRoom } from "@theokit/plugin-realtime";
 * import { z } from "zod";
 *
 * export default defineCopilot({
 *   id: "canvas-helper",
 *   room: defineRoom({
 *     id: "canvas",
 *     presence: z.object({ typing: z.boolean().optional() }),
 *     broadcast: z.object({ kind: z.string(), text: z.string() }),
 *   }),
 *   agent: {
 *     name: "GPT Copilot",
 *     model: "openrouter/openai/gpt-4o-mini",
 *     apiKey: process.env.OPENROUTER_API_KEY,
 *     systemPrompt: "You help users edit this canvas.",
 *   },
 *   identity: { name: "AI Assistant", avatar: "/ai.png", color: "#7c3aed" },
 *   triggers: [
 *     { on: "broadcast:question", action: "respond" },
 *     { on: "presence:idle", action: "suggest", idleMs: 5000 },
 *   ],
 *   rateLimit: { tokens: 100, windowMs: 60_000 },
 * });
 * ```
 *
 * @public
 */
export function defineCopilot(opts: DefineCopilotOptions): CopilotDescriptor {
  // #184: validation split into focused asserts to keep this factory's
  // cyclomatic complexity low (behavior unchanged — same checks, same codes).
  assertCopilotBaseShape(opts)
  assertCopilotAgentIdentity(opts)
  assertCopilotTriggers(opts.triggers)
  return {
    id: opts.id,
    room: opts.room,
    agent: opts.agent,
    identity: opts.identity,
    triggers: opts.triggers,
    ...(opts.rateLimit !== undefined ? { rateLimit: opts.rateLimit } : {}),
    ...(opts.budget !== undefined ? { budget: opts.budget } : {}),
    ...(opts.voice !== undefined ? { voice: opts.voice } : {}),
    ...(opts.canvas !== undefined ? { canvas: opts.canvas } : {}),
    ...(opts.dispatcher !== undefined ? { dispatcher: opts.dispatcher } : {}),
  }
}
