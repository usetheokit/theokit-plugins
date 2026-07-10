/**
 * @theokit/plugin-realtime — `defineRealtimeProvider` extension helper.
 *
 * Pass-through identity function with type narrowing — useful as a
 * documentation + extension boundary for consumer-supplied adapters
 * (Liveblocks / PartyKit / Cloudflare DO / Redis).
 *
 * @public
 */

import type { RealtimeProvider } from './types.js'

/**
 * Type-only helper for consumers implementing a custom {@link RealtimeProvider}.
 *
 * @example
 * ```ts
 * import { defineRealtimeProvider } from "@theokit/plugin-realtime";
 *
 * export const RedisRealtimeProvider = defineRealtimeProvider({
 *   name: "redis",
 *   async joinRoom(roomId, conn) { ... },
 *   async leaveRoom(roomId, connectionId) { ... },
 *   async broadcast(roomId, connectionId, event, payload) { ... },
 *   async updatePresence(roomId, connectionId, patch) { ... },
 *   async getPresence(roomId) { return {} },
 *   subscribeRoom(roomId, listener) { return () => {} },
 * });
 * ```
 *
 * @public
 */
export function defineRealtimeProvider(impl: RealtimeProvider): RealtimeProvider {
  if (impl === null || typeof impl !== 'object') {
    throw new TypeError('defineRealtimeProvider: provider implementation is required')
  }
  if (typeof impl.name !== 'string' || impl.name.length === 0) {
    throw new TypeError('defineRealtimeProvider: impl.name must be a non-empty string')
  }
  if (typeof impl.joinRoom !== 'function') {
    throw new TypeError('defineRealtimeProvider: impl.joinRoom must be a function')
  }
  if (typeof impl.leaveRoom !== 'function') {
    throw new TypeError('defineRealtimeProvider: impl.leaveRoom must be a function')
  }
  if (typeof impl.broadcast !== 'function') {
    throw new TypeError('defineRealtimeProvider: impl.broadcast must be a function')
  }
  if (typeof impl.updatePresence !== 'function') {
    throw new TypeError('defineRealtimeProvider: impl.updatePresence must be a function')
  }
  if (typeof impl.getPresence !== 'function') {
    throw new TypeError('defineRealtimeProvider: impl.getPresence must be a function')
  }
  if (typeof impl.subscribeRoom !== 'function') {
    throw new TypeError('defineRealtimeProvider: impl.subscribeRoom must be a function')
  }
  return impl
}
