/**
 * @theokit/plugin-realtime — `defineRoom` factory (P#9 public API).
 *
 * Per ADR D3 (room namespace mirroring G6 router convention).
 *
 * @public
 */

import type {
  AuthorizeContext,
  BroadcastPayload,
  Presence,
  RoomDescriptor,
  RoomStorage,
  ZodLike,
} from './types.js'

/**
 * Options accepted by {@link defineRoom}.
 *
 * @public
 */
export interface DefineRoomOptions<P extends Presence, E extends BroadcastPayload> {
  /** Stable room identifier (URL-safe, non-empty). */
  id: string
  /** Zod schema for per-connection presence. */
  presence: ZodLike<P>
  /** Zod schema for broadcast event payloads. */
  broadcast: ZodLike<E>
  /** Optional Yjs storage opt-in (`"yjs"` enables CRDT Y.Doc per room). */
  storage?: RoomStorage
  /**
   * Optional per-room authorize hook. Called when a connection attempts
   * to join. Return `false` (or a Promise resolving to `false`) to reject;
   * the runtime surfaces a {@link import('./types.js').RealtimeAuthorizationError}.
   */
  authorize?: (ctx: AuthorizeContext) => boolean | Promise<boolean>
}

/**
 * Define a multiplayer room descriptor. Pair with a {@link import('./types.js').RealtimeProvider}
 * + theokit/server scanner (`app/rooms/**\/*.ts` convention) at runtime.
 *
 * @example
 * ```ts
 * import { defineRoom } from "@theokit/plugin-realtime";
 * import { z } from "zod";
 *
 * export default defineRoom({
 *   id: "canvas",
 *   presence: z.object({
 *     cursor: z.tuple([z.number(), z.number()]).optional(),
 *     selectedShapeId: z.string().optional(),
 *   }),
 *   broadcast: z.object({ kind: z.literal("ping"), at: z.number() }),
 * });
 * ```
 *
 * @public
 */
export function defineRoom<P extends Presence, E extends BroadcastPayload>(
  opts: DefineRoomOptions<P, E>,
): RoomDescriptor<P, E> {
  if (opts === null || typeof opts !== 'object') {
    throw new TypeError('defineRoom: options object is required')
  }
  if (typeof opts.id !== 'string' || opts.id.length === 0) {
    throw new TypeError('defineRoom: opts.id must be a non-empty string')
  }
  if (opts.presence === undefined || typeof opts.presence.safeParse !== 'function') {
    throw new TypeError('defineRoom: opts.presence must be a Zod schema (or ZodLike)')
  }
  if (opts.broadcast === undefined || typeof opts.broadcast.safeParse !== 'function') {
    throw new TypeError('defineRoom: opts.broadcast must be a Zod schema (or ZodLike)')
  }
  if (opts.storage !== undefined && opts.storage !== 'yjs') {
    throw new TypeError(
      `defineRoom: opts.storage must be "yjs" or undefined; got ${String(opts.storage)}`,
    )
  }
  if (opts.authorize !== undefined && typeof opts.authorize !== 'function') {
    throw new TypeError('defineRoom: opts.authorize must be a function')
  }
  return {
    id: opts.id,
    presence: opts.presence,
    broadcast: opts.broadcast,
    ...(opts.storage !== undefined ? { storage: opts.storage } : {}),
    ...(opts.authorize !== undefined ? { authorize: opts.authorize } : {}),
  }
}
