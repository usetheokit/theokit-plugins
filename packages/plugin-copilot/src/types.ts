/**
 * @theokit/plugin-copilot — Type contract (P#11 v0.1.0).
 *
 * Per ADRs D1-D8 (blueprint p11-plugin-copilot SHIPPABLE 100/100).
 *
 * Integration plugin — composes @theokit/sdk Agent + G8 subscribe + P#9
 * plugin-realtime + P#10 plugin-rate-limit + opt-in plugin-canvas/voice +
 * theo-ui composites. Structural types avoid hard imports of peers.
 *
 * @public
 */

/**
 * Identity of a copilot as a P#9 RoomMember. Visible to other room participants
 * via the presence Map (per ADR D2).
 *
 * @public
 */
export interface CopilotIdentity {
  /** Display name shown in chat-message + presence list (e.g. "GPT Copilot"). */
  readonly name: string
  /** Avatar URL (theo-ui chat-message renders this). */
  readonly avatar?: string
  /** Theme color for typing indicator + cursor (hex, e.g. "#7c3aed"). */
  readonly color?: string
  /** Optional opaque metadata propagated via presence. */
  readonly metadata?: Record<string, unknown>
}

/**
 * Agent configuration — fed directly to @theokit/sdk `Agent.streamObject` /
 * `Agent.send` (D39 + D4 ADR).
 *
 * @public
 */
export interface CopilotAgentConfig {
  /** Logical name (for telemetry). */
  readonly name: string
  /** Model id (e.g. "openrouter/openai/gpt-4o-mini"). */
  readonly model: string | { readonly id: string }
  /** API key (or undefined to use env). Accepts a thunk for lazy/rotated keys. */
  readonly apiKey?: string | (() => string)
  /** Optional system prompt. */
  readonly systemPrompt?: string
  /** Pass-through local options (sdk LocalOptions). */
  readonly local?: { readonly settingSources?: readonly string[] }
}

/**
 * Trigger config per ADR D3. Declarative reactive model: WHEN the copilot acts.
 *
 * @public
 */
export type CopilotTrigger =
  | { readonly on: `broadcast:${string}`; readonly action: 'respond' }
  | { readonly on: 'presence:idle'; readonly action: 'suggest'; readonly idleMs: number }
  | {
      readonly on: `broadcast:${string}`
      readonly action: 'execute-tool'
      readonly toolName: string
    }
  | {
      readonly on: 'custom'
      readonly filter: (frame: CopilotFrame) => boolean
      readonly action: 'respond' | 'suggest' | 'execute-tool'
    }

/**
 * Frame shape received from P#9 (structural mirror of RealtimeFrame).
 *
 * @public
 */
export type CopilotFrame =
  | {
      readonly type: 'joined'
      readonly connectionId: string
      readonly presence: Record<string, unknown>
    }
  | { readonly type: 'left'; readonly connectionId: string }
  | {
      readonly type: 'presence-changed'
      readonly connectionId: string
      readonly presence: Record<string, unknown>
    }
  | {
      readonly type: 'broadcast'
      readonly connectionId: string
      readonly event: string
      readonly payload: Record<string, unknown>
    }

/**
 * P#9 RoomDescriptor structural mirror. Copilot binds to one room descriptor.
 *
 * @public
 */
export interface CopilotRoomBinding {
  readonly id: string
  readonly presence: {
    safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown }
  }
  readonly broadcast: {
    safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown }
  }
}

/**
 * P#9 RealtimeProvider structural mirror. Copilot delegates joinRoom /
 * broadcast / updatePresence / subscribeRoom to whatever provider the
 * consumer passes (Memory default OR Yjs).
 *
 * @public
 */
export interface CopilotRealtimeProvider {
  joinRoom(
    roomId: string,
    connection: { connectionId: string; clientId?: string; metadata?: Record<string, unknown> },
    initialPresence?: Record<string, unknown>,
  ): Promise<void>
  leaveRoom(roomId: string, connectionId: string): Promise<void>
  broadcast(
    roomId: string,
    connectionId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void>
  updatePresence(
    roomId: string,
    connectionId: string,
    patch: Record<string, unknown>,
  ): Promise<void>
  getPresence(roomId: string): Promise<Record<string, Record<string, unknown>>>
  subscribeRoom(roomId: string, listener: (frame: CopilotFrame) => void): () => void
}

/**
 * Budget integration config (per ADR D7). Wires SDK Budget D375-D388.
 *
 * @public
 */
export interface CopilotBudgetConfig {
  perRoom?: {
    dailyUsd?: number
    monthlyUsd?: number
    perRequestUsd?: number
  }
}

/**
 * Voice integration opt-in (per ADR D8).
 *
 * @public
 */
export interface CopilotVoiceConfig {
  transcribeWith?: 'plugin-voice'
  speakWith?: 'plugin-voice'
}

/**
 * Canvas integration opt-in (per ADR D8).
 *
 * @public
 */
export interface CopilotCanvasConfig {
  emitArtifacts?: boolean
}

/**
 * Rate-limit integration opt-in (passes to P#10 withRateLimit at wire layer).
 *
 * @public
 */
export interface CopilotRateLimitConfig {
  tokens: number
  windowMs: number
}

/**
 * Dispatcher policy for multi-copilot-per-room scenarios (per ADR D6).
 *
 * @public
 */
export type CopilotDispatcher =
  | 'first-wins'
  | 'round-robin'
  | 'all'
  | ((copilots: readonly { readonly id: string }[], frame: CopilotFrame) => readonly string[])

/**
 * Descriptor returned by {@link defineCopilot}.
 *
 * @public
 */
export interface CopilotDescriptor {
  readonly id: string
  readonly room: CopilotRoomBinding
  readonly agent: CopilotAgentConfig
  readonly identity: CopilotIdentity
  readonly triggers: readonly CopilotTrigger[]
  readonly rateLimit?: CopilotRateLimitConfig
  readonly budget?: CopilotBudgetConfig
  readonly voice?: CopilotVoiceConfig
  readonly canvas?: CopilotCanvasConfig
  readonly dispatcher?: CopilotDispatcher
}

/**
 * Base error for the copilot subsystem.
 *
 * @public
 */
export class CopilotError extends Error {
  override readonly name: string = 'CopilotError'
  readonly code?: string

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    if (options.code !== undefined) this.code = options.code
  }
}

/**
 * Thrown when copilot config is invalid OR an opt-in peer is missing.
 *
 * @public
 */
export class CopilotConfigError extends CopilotError {
  override readonly name: string = 'CopilotConfigError'

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { code: options.code ?? 'copilot_config_invalid', cause: options.cause })
  }
}

/**
 * Thrown when a copilot trigger evaluation fails.
 *
 * @public
 */
export class CopilotTriggerError extends CopilotError {
  override readonly name: string = 'CopilotTriggerError'

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { code: options.code ?? 'copilot_trigger_failed', cause: options.cause })
  }
}

/**
 * SDK Agent structural mirror (D39 + D4) — avoid hard import to keep
 * @theokit/sdk a runtime-resolved peer.
 *
 * @public
 */
export interface CopilotAgentLike {
  streamObject<T>(opts: {
    schema: unknown
    prompt: string
    model: string | { id: string }
    apiKey?: string
    local?: { settingSources?: readonly string[] }
    systemPrompt?: string
    maxRetries?: number
  }): AsyncIterable<
    | { type: 'partial'; partial: T; attempt: number }
    // #174: the complete event MAY carry the provider's actual usage/cost so
    // budget accounting reflects real spend; absent → the runtime falls back to
    // its configured per-invocation estimate.
    | { type: 'complete'; object: T; usage?: { costUsd?: number } }
  >

  send?(message: string, opts?: Record<string, unknown>): Promise<{ text: string }>
}
