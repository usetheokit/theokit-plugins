/**
 * @theokit/plugin-realtime — RealtimeRuntime (P#9 internal orchestrator).
 *
 * Per ADR D3 (defineRoom factory) + D5 (G8 subscribe ONLY transport).
 *
 * Holds room descriptor registry + bridges incoming WS subscription frames
 * to the configured {@link RealtimeProvider}. WireFrame envelope semantic
 * event types: `presence-update`, `broadcast`, `yjs-update`, `yjs-awareness`.
 *
 * @internal
 */

import {
  type AuthorizeContext,
  type BroadcastPayload,
  type ConnectionInfo,
  type Presence,
  RealtimeAuthorizationError,
  RealtimeBroadcastError,
  RealtimeError,
  type RealtimeFrame,
  RealtimePresenceError,
  type RealtimeProvider,
  RealtimeRoomNotFoundError,
  type RealtimeUnsubscribe,
  type RoomDescriptor,
} from '../types.js'

/**
 * Incoming wire frame from a client (over G8 subscribe transport).
 *
 * @public
 */
export type InboundWireFrame =
  | { readonly kind: 'presence-update'; readonly patch: Partial<Presence> }
  | {
      readonly kind: 'broadcast'
      readonly event: string
      readonly payload: BroadcastPayload
    }
  | { readonly kind: 'yjs-update'; readonly bytes: Uint8Array }
  | { readonly kind: 'yjs-awareness'; readonly bytes: Uint8Array }

/**
 * Outgoing wire frame to a client (re-broadcast from {@link RealtimeFrame}).
 *
 * @public
 */
export type OutboundWireFrame = RealtimeFrame

/**
 * Options for {@link RealtimeRuntime}.
 *
 * @public
 */
export interface RealtimeRuntimeOptions {
  /** RealtimeProvider implementation (Memory default or Yjs opt-in). */
  provider: RealtimeProvider
  /** Room descriptors to register at construction. */
  rooms?: readonly RoomDescriptor[]
}

/**
 * In-process runtime that registers rooms + bridges WS frames to the provider.
 *
 * @public
 */
export class RealtimeRuntime {
  private readonly provider: RealtimeProvider
  private readonly rooms = new Map<string, RoomDescriptor>()
  /**
   * The handle that currently owns each `(roomId, connectionId)` pair.
   *
   * Presence is keyed by `connectionId`, and `leaveRoom` deletes by that key alone. A tab that
   * reloads drops its socket without telling the server, so the dead subscription's generator
   * only notices at its next frame — by which time the same user has reconnected under the same
   * id. Its `release()` then removed the LIVE registration, and the room saw the reconnecting
   * client vanish and a `left` frame for somebody who had just joined (#110).
   *
   * Recording which handle is current makes a superseded release a no-op, which is what it
   * should always have been.
   */
  private readonly liveConnections = new Map<string, RealtimeConnectionHandle>()

  /** `\u0000` cannot appear in either part, so the pair cannot collide with another pair. */
  private static connectionKey(roomId: string, connectionId: string): string {
    return `${roomId}\u0000${connectionId}`
  }

  constructor(opts: RealtimeRuntimeOptions) {
    if (opts === null || typeof opts !== 'object') {
      throw new TypeError('RealtimeRuntime: options object is required')
    }
    if (opts.provider === undefined) {
      throw new TypeError('RealtimeRuntime: opts.provider is required')
    }
    this.provider = opts.provider
    if (opts.rooms !== undefined) {
      for (const room of opts.rooms) {
        this.registerRoom(room)
      }
    }
  }

  /** Register a {@link RoomDescriptor}. Idempotent (replaces existing by id). */
  registerRoom(room: RoomDescriptor): void {
    this.rooms.set(room.id, room)
  }

  /** Unregister a room by id. Returns `true` if removed. */
  unregisterRoom(id: string): boolean {
    return this.rooms.delete(id)
  }

  /** Look up a registered room descriptor. */
  getRoom(id: string): RoomDescriptor | undefined {
    return this.rooms.get(id)
  }

  /**
   * Handle a new connection joining a room. Runs the room's `authorize` hook
   * + validates initial presence + delegates to provider. Returns a handle
   * with `unsubscribe` + frame dispatcher for the subscription lifecycle.
   */
  async handleConnection(
    roomId: string,
    connection: ConnectionInfo,
    initialPresence: Presence | undefined,
    onFrame: (frame: OutboundWireFrame) => void,
  ): Promise<RealtimeConnectionHandle> {
    const room = this.rooms.get(roomId)
    if (room === undefined) {
      throw new RealtimeRoomNotFoundError(roomId)
    }
    // Authorize hook.
    if (room.authorize !== undefined) {
      const ctx: AuthorizeContext = { roomId, connection }
      const ok = await room.authorize(ctx)
      if (!ok) {
        throw new RealtimeAuthorizationError(roomId)
      }
    }
    // Validate initial presence (if provided).
    let validatedInitial: Presence | undefined
    if (initialPresence !== undefined) {
      const parsed = room.presence.safeParse(initialPresence)
      if (!parsed.success) {
        throw new RealtimePresenceError(`Invalid initial presence for room ${roomId}`, {
          issues: parsed.error,
        })
      }
      validatedInitial = parsed.data
    }
    // Subscribe to provider frames + bridge to onFrame.
    const unsubscribe = this.provider.subscribeRoom(roomId, onFrame)
    // Join the room.
    await this.provider.joinRoom(roomId, connection, validatedInitial)
    const handle = new RealtimeConnectionHandle(this, roomId, connection.connectionId, unsubscribe)
    this.liveConnections.set(RealtimeRuntime.connectionKey(roomId, connection.connectionId), handle)
    return handle
  }

  /**
   * Release `handle`, unless a newer connection has taken over its `(room, connectionId)`.
   *
   * @internal
   */
  async releaseConnection(handle: RealtimeConnectionHandle): Promise<void> {
    const key = RealtimeRuntime.connectionKey(handle.roomId, handle.connectionId)
    // Superseded: the entry belongs to a live connection now, and leaving on its behalf would
    // remove somebody who is still here.
    if (this.liveConnections.get(key) !== handle) return
    this.liveConnections.delete(key)
    await this.leaveRoom(handle.roomId, handle.connectionId)
  }

  /**
   * Dispatch an inbound wire frame from a connection. Validates per the
   * registered room descriptor (presence + broadcast schemas) + delegates
   * to the provider.
   */
  async dispatchFrame(
    roomId: string,
    connectionId: string,
    frame: InboundWireFrame,
  ): Promise<void> {
    const room = this.rooms.get(roomId)
    if (room === undefined) {
      throw new RealtimeRoomNotFoundError(roomId)
    }
    switch (frame.kind) {
      case 'presence-update': {
        // Validate the FULL MERGED shape, which is what this comment always claimed and what the
        // code did not do: it parsed the PATCH, so a room with any required presence field
        // rejected every partial update. `useUpdateMyPresence(patch)` can only ever send a patch,
        // so the advertised presence path was dead for those rooms — and silently, because the
        // rejection surfaces as a rejected promise inside a React callback while the local merge
        // has already happened. A UI that looks synced and is not.
        //
        // Found because the seam test used the one schema shape that passes: all fields optional.
        // A fake agrees with whoever wrote it.
        const current = (await this.provider.getPresence(roomId))[connectionId] ?? {}
        const merged = { ...current, ...frame.patch }
        const parsed = room.presence.safeParse(merged)
        if (!parsed.success) {
          throw new RealtimePresenceError(
            `Invalid presence for room ${roomId}: the patch does not merge into a valid presence`,
            { issues: parsed.error },
          )
        }
        // The provider merges again over its own copy, which is idempotent for a fixed patch and
        // keeps the provider authoritative about state it may have changed concurrently.
        await this.provider.updatePresence(roomId, connectionId, frame.patch)
        return
      }
      case 'broadcast': {
        const parsed = room.broadcast.safeParse(frame.payload)
        if (!parsed.success) {
          throw new RealtimeBroadcastError(`Invalid broadcast payload for room ${roomId}`, {
            issues: parsed.error,
          })
        }
        await this.provider.broadcast(roomId, connectionId, frame.event, parsed.data)
        return
      }
      case 'yjs-update': {
        if (this.provider.applyYjsUpdate === undefined) {
          // #197 (Rule 8): a room that declares storage:"yjs" but is wired to a
          // provider with no Yjs support is a misconfiguration — fail loudly
          // instead of silently dropping CRDT frames (which loses document state).
          if (room.storage === 'yjs') {
            throw new RealtimeError(
              `Room "${roomId}" declares storage:"yjs" but provider "${this.provider.name}" does not implement applyYjsUpdate. ` +
                'Use a Yjs-capable provider (createYjsRealtimeProvider) or remove storage:"yjs".',
              { code: 'yjs_provider_unsupported' },
            )
          }
          // Non-yjs room with no provider support: nothing is expected — drop.
          return
        }
        await this.provider.applyYjsUpdate(roomId, connectionId, frame.bytes)
        return
      }
      case 'yjs-awareness': {
        if (this.provider.applyYjsAwareness === undefined) {
          // #197: same misconfiguration guard as yjs-update.
          if (room.storage === 'yjs') {
            throw new RealtimeError(
              `Room "${roomId}" declares storage:"yjs" but provider "${this.provider.name}" does not implement applyYjsAwareness. ` +
                'Use a Yjs-capable provider (createYjsRealtimeProvider) or remove storage:"yjs".',
              { code: 'yjs_provider_unsupported' },
            )
          }
          return
        }
        await this.provider.applyYjsAwareness(roomId, connectionId, frame.bytes)
        return
      }
    }
  }

  /** Internal — accessor for connection handles. */
  async leaveRoom(roomId: string, connectionId: string): Promise<void> {
    await this.provider.leaveRoom(roomId, connectionId)
  }

  /** Read-only snapshot of presence for ops visibility. */
  getPresence(roomId: string): Promise<Record<string, Presence>> {
    return this.provider.getPresence(roomId)
  }
}

/**
 * Handle returned by {@link RealtimeRuntime.handleConnection}. Call
 * `release()` on disconnect to leave the room + unsubscribe.
 *
 * @public
 */
export class RealtimeConnectionHandle {
  private released = false

  constructor(
    private readonly runtime: RealtimeRuntime,
    readonly roomId: string,
    readonly connectionId: string,
    private readonly unsubscribe: RealtimeUnsubscribe,
  ) {}

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    // Always drop this connection's frame subscription — a superseded handle still has one,
    // and leaving it attached is the leak #195 was about.
    this.unsubscribe()
    await this.runtime.releaseConnection(this)
  }
}
