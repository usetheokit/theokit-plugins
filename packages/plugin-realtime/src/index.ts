/**
 * @theokit/plugin-realtime — public barrel (P#9 v0.1.0).
 *
 * Per ADRs D1-D8 (blueprint p9-plugin-realtime SHIPPABLE 99.2).
 *
 * @public
 */

export {
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
  type RealtimeJson,
  type RealtimeUnsubscribe,
  type RoomDescriptor,
  type RoomStorage,
} from './types.js'

export { defineRoom, type DefineRoomOptions } from './define-room.js'

export { defineRealtimeProvider } from './provider.js'

export { createMemoryRealtimeProvider } from './memory-provider.js'

export { createYjsRealtimeProvider, type YjsRealtimeProviderOptions } from './yjs-provider.js'

export {
  type InboundWireFrame,
  type OutboundWireFrame,
  RealtimeConnectionHandle,
  RealtimeRuntime,
  type RealtimeRuntimeOptions,
} from './internal/runtime.js'

export {
  type MountedRealtime,
  type MountedSubscriptionCtx,
  type MountRealtimeOptions,
  mountRealtime,
  type RealtimeSubscriptionHandler,
  type RealtimeSubscriptionInput,
  type RealtimeSubscriptionOutput,
} from './internal/server-integration.js'
