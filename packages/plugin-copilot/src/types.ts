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
 * The SDK's own deep-partial, imported rather than restated.
 *
 * This file's header notes that structural types avoid hard imports of peers, and that
 * still holds where it matters: `import type` is erased at build, so nothing here reaches
 * the bundle. What it buys is exactness — a locally rewritten `DeepPartial` would be a
 * second definition of a shape the SDK already owns, and `partial` is precisely where
 * this package last got someone else's shape wrong (#62).
 */
import type { DeepPartial } from '@theokit/sdk'
import type { z } from 'zod'

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
 * Frame shape received from P#9 — a structural mirror of `RealtimeFrame` in
 * `@theokit/plugin-realtime`, kept as a mirror rather than an import so this package does
 * not take a hard dependency on it (ADR D4).
 *
 * A mirror only works while it is complete, and nothing made it so until
 * `tests/composes-with-realtime.test.ts` existed. Add a variant upstream, add it here.
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
  // The Yjs pair arrived in `plugin-realtime` with collaborative editing and was never copied
  // here. A mirror missing a variant the original can emit is not a mirror: listeners are
  // contravariant, so a `RealtimeProvider` stopped being assignable to `CopilotRealtimeProvider`
  // and a consumer wiring the two — which this package's peer dependency invites — got a `tsc`
  // error about `subscribeRoom`, several layers from the cause.
  //
  // `tests/composes-with-realtime.test.ts` performs that assignment, so the next variant added
  // upstream fails here instead of in an app.
  | { readonly type: 'yjs-update'; readonly connectionId: string; readonly bytes: Uint8Array }
  | { readonly type: 'yjs-awareness'; readonly connectionId: string; readonly bytes: Uint8Array }

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
    /** Sugar for the SDK's `1d` window. */
    dailyUsd?: number
    /**
     * Sugar for the SDK's `30d` window — **rolling 30 days, not a calendar month**.
     *
     * Named honestly here because the two differ in both directions and the difference
     * is money: a $100 cap spent on 1 January frees up on 31 January under a rolling
     * window and on 1 February under a calendar month, while in a 28-day February the
     * rolling window still remembers spend from January. Before #62 this field was a
     * calendar month, tracked by this package; the SDK's window vocabulary has no
     * calendar-month member, and re-implementing one here is the duplication #62
     * removed.
     *
     * Use {@link CopilotBudgetConfig.perRoom.limits} when the exact window matters.
     */
    monthlyUsd?: number
    /**
     * Cap on a single invocation. Has no SDK equivalent — the SDK's limits are windows,
     * and "per call" is not a window — so this one is enforced by the plugin.
     */
    perRequestUsd?: number
    /**
     * The SDK's own window vocabulary, for when the sugar above is not precise enough.
     * Merged with whatever `dailyUsd` / `monthlyUsd` express; any exceeded limit blocks
     * (SDK D384).
     */
    limits?: readonly {
      readonly window: '1h' | '1d' | '1w' | '30d' | '365d'
      readonly limitUsd: number
    }[]
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
 * Usage on a `complete` event, as the two kinds of agent report it (#61, #62).
 *
 * `inputTokens`/`outputTokens` is what `@theokit/sdk`'s `StreamObjectEvent` carries and
 * is the canonical path — `settleCost` prices it through the SDK's `computeCost`.
 *
 * `costUsd` is for an agent that already knows what it spent, because it saw the
 * provider's own accounting. It is NOT the SDK's shape, and treating it as such is the
 * defect this type replaces: the runtime read `usage.costUsd`, no SDK event ever set it,
 * and the spend ceiling silently checked the configured estimate forever.
 *
 * Every field is optional so a minimal agent stays valid, and an event with none of them
 * settles at the estimate — stated rather than assumed.
 *
 * @public
 */
export interface CopilotUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly costUsd?: number
}

/**
 * The stream a copilot's agent produces.
 *
 * Structural on purpose, and that is a decision rather than an omission: any object with
 * a compatible `streamObject` works, which is what lets a test drive a deterministic
 * agent and a consumer bring one this package has never heard of.
 *
 * The SCHEMA parameter is typed as `z.ZodType` rather than mirrored structurally. An earlier
 * version avoided that to keep zod out of the contract — but zod is already a declared
 * dependency of this package and `internal/runtime.ts` imports it at runtime, so the avoidance
 * bought nothing and cost the contract its only real implementation.
 *
 * The shape mirrors `@theokit/sdk`'s `StreamObjectEvent`, and `tests/sdk-shape.test.ts`
 * is what holds the mirror to the original: it asserts a real `StreamObjectEvent` is
 * assignable here. Before that assertion existed the two drifted — the SDK reported
 * `usage: { inputTokens, outputTokens }` while this type declared
 * `usage?: { costUsd?: number }`, and nothing noticed for a release (#61).
 *
 * @public
 */
export interface CopilotAgentLike {
  // Parameterised on the SCHEMA, not on the object — which is what `@theokit/sdk`'s `Agent`
  // does (`streamObject<T extends ZodType>(…): AsyncGenerator<StreamObjectEvent<z.infer<T>>>`).
  //
  // It used to read `streamObject<T>(opts: { schema: unknown; … })` with `DeepPartial<T>` on the
  // way out. That `T` was determined by no parameter, so TypeScript instantiated it as `unknown`
  // and no real implementation could satisfy the interface: a callee cannot produce a type the
  // caller picks arbitrarily with nothing to infer it from. `typeof Agent` — the only agent this
  // ecosystem ships — was not assignable, while the README invited exactly that wiring.
  //
  // Still structural on purpose: any object with a compatible `streamObject` works, which is what
  // lets a test drive a deterministic agent.
  streamObject<S extends z.ZodType>(opts: {
    schema: S
    prompt: string
    model: string | { id: string }
    apiKey?: string
    local?: { settingSources?: readonly string[] }
    systemPrompt?: string
    maxRetries?: number
  }): AsyncIterable<
    | { type: 'partial'; partial: DeepPartial<z.infer<S>>; attempt: number }
    // Extra fields the SDK sets (`raw`, `finishReason`) are accepted and ignored: this
    // is a supertype of the SDK event, not a copy of it.
    | { type: 'complete'; object: z.infer<S>; usage?: CopilotUsage }
  >

  send?(message: string, opts?: Record<string, unknown>): Promise<{ text: string }>
}
