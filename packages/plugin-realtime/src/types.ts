/**
 * @theokit/plugin-realtime — Type contract (P#9 v0.1.0).
 *
 * Per ADRs D1-D7 (blueprint p9-plugin-realtime SHIPPABLE 99.2):
 * - D1: Form 4 Hybrid (interface + Memory default + Yjs opt-in + extension)
 * - D5: G8 subscribe ONLY transport (single multiplexed WS per browser tab)
 * - D6: per-room Map in-memory presence (LWW)
 * - D7: Provider-determined Awareness semantics (Memory LWW OR Yjs Awareness)
 *
 * @public
 */

/**
 * JSON-compatible value (matches what survives JSON.stringify round-trip).
 *
 * @public
 */
export type RealtimeJson =
  | string
  | number
  | boolean
  | null
  | RealtimeJson[]
  | { [key: string]: RealtimeJson }

/**
 * Per-connection presence state. Free-form JSON object (consumer-supplied
 * via Zod schema validation at `defineRoom` boundary).
 *
 * @public
 */
export type Presence = Record<string, RealtimeJson>

/**
 * Broadcast event payload. Free-form JSON object.
 *
 * @public
 */
export type BroadcastPayload = Record<string, RealtimeJson>

/**
 * Connection metadata exposed to providers + authorize hooks.
 *
 * @public
 */
export interface ConnectionInfo {
  /** Stable identifier for the underlying WS connection. */
  readonly connectionId: string
  /** Optional consumer-supplied client identifier (e.g., authenticated userId). */
  readonly clientId?: string
  /** Free-form metadata propagated from G8 subscription context. */
  readonly metadata?: Record<string, RealtimeJson>
}

/**
 * Frame types broadcast by a {@link RealtimeProvider} via `subscribeRoom`.
 *
 * @public
 */
export type RealtimeFrame =
  | { readonly type: 'joined'; readonly connectionId: string; readonly presence: Presence }
  | { readonly type: 'left'; readonly connectionId: string }
  | {
      readonly type: 'presence-changed'
      readonly connectionId: string
      readonly presence: Presence
    }
  | {
      readonly type: 'broadcast'
      readonly connectionId: string
      readonly event: string
      readonly payload: BroadcastPayload
    }
  | { readonly type: 'yjs-update'; readonly connectionId: string; readonly bytes: Uint8Array }
  | {
      readonly type: 'yjs-awareness'
      readonly connectionId: string
      readonly bytes: Uint8Array
    }

/**
 * Minimal structural Zod-like type (avoid hard zod peer for type declarations).
 *
 * @internal
 */
export interface ZodLike<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown }
  parse(value: unknown): T
}

/**
 * Per-room authorize hook context. Consumer wires G11 `defineAuth`-derived
 * identity at the WS upgrade boundary; this hook receives that identity.
 *
 * @public
 */
export interface AuthorizeContext {
  readonly roomId: string
  readonly connection: ConnectionInfo
}

/**
 * Storage backend identifier. v0.1 supports `"yjs"` only (CRDT via Y.Doc);
 * `undefined` means presence + broadcast only (no persisted storage).
 *
 * @public
 */
export type RoomStorage = 'yjs' | undefined

/**
 * Room descriptor returned by {@link defineRoom}.
 *
 * @public
 */
export interface RoomDescriptor<
  P extends Presence = Presence,
  E extends BroadcastPayload = BroadcastPayload,
> {
  readonly id: string
  readonly presence: ZodLike<P>
  readonly broadcast: ZodLike<E>
  readonly storage?: RoomStorage
  readonly authorize?: (ctx: AuthorizeContext) => boolean | Promise<boolean>
}

/**
 * Unsubscribe function returned by {@link RealtimeProvider.subscribeRoom}.
 *
 * @public
 */
export type RealtimeUnsubscribe = () => void

/**
 * Core abstraction (per ADR D1). Backed by {@link createMemoryRealtimeProvider}
 * for dev / single-node OR {@link createYjsRealtimeProvider} for CRDT-aware
 * multiplayer. Consumers can ship custom adapters via {@link defineRealtimeProvider}.
 *
 * @public
 */
export interface RealtimeProvider {
  readonly name: string

  /** Add a connection to a room. Idempotent for the same (roomId, connectionId). */
  joinRoom(roomId: string, connection: ConnectionInfo, initialPresence?: Presence): Promise<void>

  /** Remove a connection from a room. No-op if not present. */
  leaveRoom(roomId: string, connectionId: string): Promise<void>

  /** Fan-out a broadcast event to all room participants. */
  broadcast(
    roomId: string,
    connectionId: string,
    event: string,
    payload: BroadcastPayload,
  ): Promise<void>

  /** Merge a partial presence patch for the given connection. */
  updatePresence(roomId: string, connectionId: string, patch: Partial<Presence>): Promise<void>

  /** Read-only snapshot of all connection presences in the room. */
  getPresence(roomId: string): Promise<Record<string, Presence>>

  /** Subscribe to {@link RealtimeFrame}s emitted by the room. */
  subscribeRoom(roomId: string, listener: (frame: RealtimeFrame) => void): RealtimeUnsubscribe

  /**
   * Apply a binary Y.Doc update (Yjs storage = "yjs" rooms only).
   * No-op on providers without CRDT support.
   */
  applyYjsUpdate?(roomId: string, connectionId: string, bytes: Uint8Array): Promise<void>

  /**
   * Apply a binary Awareness update (Yjs awareness-aware providers).
   * No-op on providers without Awareness support.
   */
  applyYjsAwareness?(roomId: string, connectionId: string, bytes: Uint8Array): Promise<void>
}

/**
 * Base error for the realtime subsystem. Standalone class (does NOT extend
 * TheokitAgentError — keeps plugin boundary clean per blueprint open-items;
 * consumers branching on `instanceof Error` still work).
 *
 * @public
 */
export class RealtimeError extends Error {
  override readonly name: string = 'RealtimeError'
  readonly code?: string

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    if (options.code !== undefined) this.code = options.code
  }
}

/**
 * Thrown when presence patch fails schema validation.
 *
 * @public
 */
export class RealtimePresenceError extends RealtimeError {
  override readonly name: string = 'RealtimePresenceError'

  readonly issues: unknown

  constructor(message: string, options: { issues: unknown; cause?: unknown }) {
    super(message, { code: 'presence_invalid', cause: options.cause })
    this.issues = options.issues
  }
}

/**
 * Thrown when broadcast event fails schema validation.
 *
 * @public
 */
export class RealtimeBroadcastError extends RealtimeError {
  override readonly name: string = 'RealtimeBroadcastError'

  readonly issues: unknown

  constructor(message: string, options: { issues: unknown; cause?: unknown }) {
    super(message, { code: 'broadcast_invalid', cause: options.cause })
    this.issues = options.issues
  }
}

/**
 * Thrown when a room is not registered with the runtime.
 *
 * @public
 */
export class RealtimeRoomNotFoundError extends RealtimeError {
  override readonly name: string = 'RealtimeRoomNotFoundError'

  constructor(roomId: string) {
    super(`Realtime room not found: ${roomId}`, { code: 'room_not_found' })
  }
}

/**
 * Thrown when a room's `authorize` hook rejects a connection.
 *
 * @public
 */
export class RealtimeAuthorizationError extends RealtimeError {
  override readonly name: string = 'RealtimeAuthorizationError'

  readonly roomId: string

  constructor(roomId: string) {
    super(`Realtime authorization rejected for room: ${roomId}`, {
      code: 'authorization_rejected',
    })
    this.roomId = roomId
  }
}
