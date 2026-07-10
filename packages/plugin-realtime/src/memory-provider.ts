/**
 * @theokit/plugin-realtime — MemoryRealtimeProvider (P#9 default).
 *
 * Per ADR D1 (Form 4 Hybrid default) + D6 (per-room Map LWW) + D7 (custom LWW
 * presence semantics).
 *
 * In-process single-node provider; zero deps. Suitable for dev + single-server
 * deployments. Cluster setups should ship a custom adapter (Redis/CF DO) via
 * {@link defineRealtimeProvider}.
 *
 * @public
 */

import {
  type BroadcastPayload,
  type ConnectionInfo,
  type Presence,
  type RealtimeFrame,
  type RealtimeProvider,
  type RealtimeUnsubscribe,
} from './types.js'

interface RoomState {
  /** Per-connection presence Map (LWW). */
  readonly presences: Map<string, Presence>
  /** Active room listeners (subscribeRoom). */
  readonly listeners: Set<(frame: RealtimeFrame) => void>
}

/**
 * Create a fresh in-process realtime provider. Each instance keeps its own
 * `Map<roomId, RoomState>`; different instances are isolated.
 *
 * @public
 */
export function createMemoryRealtimeProvider(): RealtimeProvider {
  const rooms = new Map<string, RoomState>()

  const ensureRoom = (roomId: string): RoomState => {
    let state = rooms.get(roomId)
    if (state === undefined) {
      state = { presences: new Map(), listeners: new Set() }
      rooms.set(roomId, state)
    }
    return state
  }

  const fanout = (roomId: string, frame: RealtimeFrame): void => {
    const state = rooms.get(roomId)
    if (state === undefined) return
    for (const listener of state.listeners) {
      try {
        listener(frame)
      } catch (listenerErr) {
        console.error('[plugin-realtime] listener error in fanout:', {
          event: frame.type ?? 'unknown',
          error: listenerErr,
        })
      }
    }
  }

  return {
    name: 'memory',

    joinRoom(roomId, connection, initialPresence): Promise<void> {
      const state = ensureRoom(roomId)
      const presence: Presence = initialPresence ?? {}
      state.presences.set(connection.connectionId, presence)
      fanout(roomId, {
        type: 'joined',
        connectionId: connection.connectionId,
        presence,
      })
      return Promise.resolve()
    },

    leaveRoom(roomId, connectionId): Promise<void> {
      const state = rooms.get(roomId)
      if (state === undefined) return Promise.resolve()
      const had = state.presences.delete(connectionId)
      if (!had) return Promise.resolve()
      fanout(roomId, { type: 'left', connectionId })
      // Garbage-collect empty rooms with no listeners to keep memory bounded.
      if (state.presences.size === 0 && state.listeners.size === 0) {
        rooms.delete(roomId)
      }
      return Promise.resolve()
    },

    broadcast(roomId, connectionId, event, payload): Promise<void> {
      // Broadcast does NOT require the sender to be in the room — runtime can
      // emit server-originated events via a synthetic connectionId. But we
      // still want a registered room before fanning out.
      const state = rooms.get(roomId)
      if (state === undefined) return Promise.resolve()
      fanout(roomId, {
        type: 'broadcast',
        connectionId,
        event,
        payload,
      })
      return Promise.resolve()
    },

    updatePresence(roomId, connectionId, patch): Promise<void> {
      const state = rooms.get(roomId)
      if (state === undefined) return Promise.resolve()
      const current = state.presences.get(connectionId)
      if (current === undefined) return Promise.resolve()
      const next = { ...current, ...patch } as Presence
      state.presences.set(connectionId, next)
      fanout(roomId, {
        type: 'presence-changed',
        connectionId,
        presence: next,
      })
      return Promise.resolve()
    },

    getPresence(roomId): Promise<Record<string, Presence>> {
      const state = rooms.get(roomId)
      if (state === undefined) return Promise.resolve({})
      // Return a snapshot (shallow copy) so callers can't mutate internal state.
      const snapshot: Record<string, Presence> = {}
      for (const [connId, p] of state.presences) {
        snapshot[connId] = { ...p }
      }
      return Promise.resolve(snapshot)
    },

    subscribeRoom(roomId, listener): RealtimeUnsubscribe {
      const state = ensureRoom(roomId)
      state.listeners.add(listener)
      return () => {
        state.listeners.delete(listener)
        if (state.presences.size === 0 && state.listeners.size === 0) {
          rooms.delete(roomId)
        }
      }
    },
  }
}

/**
 * Type marker — re-exported `ConnectionInfo`/`BroadcastPayload` for inline
 * access without separate import path.
 *
 * @public
 */
export type { ConnectionInfo, BroadcastPayload }
