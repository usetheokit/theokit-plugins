/**
 * @theokit/plugin-realtime — YjsRealtimeProvider (P#9 opt-in CRDT).
 *
 * Per ADR D1 (Form 4 Hybrid Yjs opt-in) + D2 (Yjs optional peer via dynamic
 * import) + D7 (Awareness-backed wire format; in-process LWW read path).
 *
 * Requires `yjs ^13` + `y-protocols ^1` optional peers. Dynamic
 * `import('yjs')` + `import('y-protocols/awareness')` on first use; throws
 * actionable {@link RealtimeError} on missing peer.
 *
 * Read/write semantics (in-process):
 * - `getPresence` / `updatePresence` use a per-room `Map<connectionId, Presence>`
 *   identical to MemoryRealtimeProvider — predictable LWW semantics.
 * - Y.Doc + Awareness are maintained per-room and exposed via `applyYjsUpdate`
 *   / `applyYjsAwareness` for the binary CRDT wire path. Awareness convergence
 *   happens when consumers ship binary updates between processes (the
 *   in-process tests exercise the LWW read path; multi-process Awareness
 *   convergence is exercised via the binary apply* methods).
 *
 * @public
 */

import {
  type BroadcastPayload,
  type ConnectionInfo,
  type Presence,
  RealtimeError,
  type RealtimeFrame,
  type RealtimeProvider,
  type RealtimeUnsubscribe,
} from './types.js'

// Structural types for yjs + y-protocols (peers may be absent).
interface YDocLike {
  readonly clientID: number
  destroy(): void
}

type YDocConstructor = new (opts?: { gc?: boolean }) => YDocLike

interface AwarenessLike {
  readonly doc: YDocLike
  readonly clientID: number
  readonly states: Map<number, Record<string, unknown>>
  getStates(): Map<number, Record<string, unknown>>
  setLocalState(state: Record<string, unknown> | null): void
  destroy(): void
}

type AwarenessConstructor = new (doc: YDocLike) => AwarenessLike

interface YjsModule {
  readonly Doc: YDocConstructor
  applyUpdate(doc: YDocLike, update: Uint8Array, origin?: unknown): void
}

interface YAwarenessModule {
  readonly Awareness: AwarenessConstructor
  applyAwarenessUpdate(awareness: AwarenessLike, update: Uint8Array, origin?: unknown): void
}

let pendingYjs: Promise<{ yjs: YjsModule; awareness: YAwarenessModule }> | null = null

function loadYjs(): Promise<{ yjs: YjsModule; awareness: YAwarenessModule }> {
  if (!pendingYjs) {
    pendingYjs = (async () => {
      let yjsModule: YjsModule
      let awarenessModule: YAwarenessModule
      try {
        yjsModule = await import('yjs')
      } catch (cause) {
        throw new RealtimeError(
          '`yjs` peer dependency not installed. Run `pnpm add yjs y-protocols` to use YjsRealtimeProvider.',
          { code: 'yjs_peer_missing', cause },
        )
      }
      try {
        awarenessModule = (await import('y-protocols/awareness.js')) as unknown as YAwarenessModule
      } catch (cause) {
        throw new RealtimeError(
          '`y-protocols/awareness` peer dependency not installed. Run `pnpm add y-protocols` to use YjsRealtimeProvider.',
          { code: 'y_protocols_peer_missing', cause },
        )
      }
      return { yjs: yjsModule, awareness: awarenessModule }
    })().catch((err) => {
      pendingYjs = null // clear on error so next caller retries
      throw err
    })
  }
  return pendingYjs
}

/** Resolved Yjs handles for a room. Returned by `ensureYjs` so callers don't
 *  re-invoke `loadYjs()` (#196). */
interface YjsBundle {
  readonly doc: YDocLike
  readonly awareness: AwarenessLike
  readonly yjs: YjsModule
  readonly awMod: YAwarenessModule
}

interface YjsRoomState {
  /** Per-connection presence (LWW; identical to MemoryProvider semantics). */
  readonly presences: Map<string, Presence>
  /** Active room listeners. */
  readonly listeners: Set<(frame: RealtimeFrame) => void>
  /**
   * In-flight (or resolved) Y.Doc/Awareness init — the SINGLE source of truth
   * for the room's doc (#193). Memoized so concurrent `applyYjs*` calls share
   * exactly one Y.Doc instead of racing on a check-then-act. There is no
   * separate `doc`/`awareness` fast-path field on purpose: two sources of truth
   * for "the room's doc" would reintroduce the race.
   */
  docInit?: Promise<YjsBundle>
  /** Synchronous handle to the resolved bundle, set INSIDE the docInit factory,
   *  so `gcIfEmpty` can destroy() without awaiting. */
  resolved?: YjsBundle
  /**
   * Count of in-flight `applyYjs*` ops holding this room (#194). Incremented
   * synchronously before the `await ensureYjs`, decremented in `finally`.
   * `gcIfEmpty` defers destroy+delete while this is > 0, so a doc can never be
   * destroyed (nor the room evicted) mid-operation — closing the apply-after-GC
   * race AND the GC-during-init orphan in one mechanism.
   */
  inflight: number
}

/**
 * Options accepted by {@link createYjsRealtimeProvider}.
 *
 * @public
 */
export interface YjsRealtimeProviderOptions {
  /**
   * Maximum Y.Doc update size in bytes (DoS mitigation per blueprint EC-7).
   * Default 1 MB.
   */
  maxUpdateBytes?: number
}

const DEFAULT_MAX_UPDATE_BYTES = 1_048_576

/**
 * Create a Yjs CRDT-backed realtime provider.
 *
 * In-process presence read/write semantics match MemoryRealtimeProvider
 * (per-room Map LWW). Y.Doc + Awareness are exposed via `applyYjsUpdate` /
 * `applyYjsAwareness` for the binary CRDT wire path used across processes.
 *
 * @public
 */
export function createYjsRealtimeProvider(opts: YjsRealtimeProviderOptions = {}): RealtimeProvider {
  const maxUpdateBytes = opts.maxUpdateBytes ?? DEFAULT_MAX_UPDATE_BYTES
  const rooms = new Map<string, YjsRoomState>()

  const ensureRoom = (roomId: string): YjsRoomState => {
    let state = rooms.get(roomId)
    if (state === undefined) {
      state = { presences: new Map(), listeners: new Set(), inflight: 0 }
      rooms.set(roomId, state)
    }
    return state
  }

  // #194 invariant: every caller of ensureYjs MUST hold an in-flight refcount
  // (state.inflight) across the call, so gcIfEmpty cannot evict the room while
  // init is in flight. The post-await membership re-check below enforces this
  // structurally — if a future caller forgets the refcount and the room is
  // evicted mid-init, the just-created doc is destroyed instead of orphaned.
  const ensureYjs = (roomId: string, state: YjsRoomState): Promise<YjsBundle> => {
    // #193: single-flight memo. `??=` is synchronous, so two concurrent callers
    // both assign the SAME factory before either yields at `await` — closing the
    // check-then-act race that previously orphaned a duplicate Y.Doc. The memo
    // also carries the loaded modules so callers stop re-invoking loadYjs (#196).
    state.docInit ??= (async (): Promise<YjsBundle> => {
      const { yjs, awareness: awMod } = await loadYjs()
      const doc = new yjs.Doc({ gc: true })
      const awareness = new awMod.Awareness(doc)
      const bundle: YjsBundle = { doc, awareness, yjs, awMod }
      // #194 belt: if the room was evicted while we initialized (only possible
      // when a caller did not hold an inflight refcount), destroy the doc now so
      // it is not orphaned, and do NOT publish `resolved` on the dead room. The
      // caller's post-await membership guard will skip the apply.
      if (rooms.get(roomId) !== state) {
        awareness.destroy()
        doc.destroy()
      } else {
        // Synchronous handle for gcIfEmpty.destroy() (set after the awaits).
        state.resolved = bundle
      }
      return bundle
    })().catch((e) => {
      // EC-1: a failed init clears the memo so a later apply can recreate the
      // doc — no permanently bricked room.
      state.docInit = undefined
      throw e
    })
    return state.docInit
  }

  const fanout = (state: YjsRoomState, frame: RealtimeFrame): void => {
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

  const gcIfEmpty = (roomId: string, state: YjsRoomState): void => {
    if (state.presences.size === 0 && state.listeners.size === 0) {
      // #194: defer destroy AND room-map eviction while an apply is in flight.
      // Coupling these two deferrals is load-bearing: it prevents both a
      // destroy-during-apply AND a room-identity swap (a new joinRoom would get
      // the SAME state object since it is not evicted). The in-flight op's
      // finally re-invokes gcIfEmpty once inflight hits 0.
      if (state.inflight > 0) return
      // Only a resolved bundle has a doc to destroy. A doc whose init is still
      // in flight (resolved === undefined) cannot be reached here because the
      // initiating apply holds inflight > 0 above.
      if (state.resolved !== undefined) {
        state.resolved.awareness.destroy()
        state.resolved.doc.destroy()
      }
      rooms.delete(roomId)
    }
  }

  return {
    name: 'yjs',

    joinRoom(roomId, connection, initialPresence): Promise<void> {
      const state = ensureRoom(roomId)
      const presence: Presence = initialPresence ?? {}
      state.presences.set(connection.connectionId, presence)
      fanout(state, {
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
      fanout(state, { type: 'left', connectionId })
      gcIfEmpty(roomId, state)
      return Promise.resolve()
    },

    broadcast(roomId, connectionId, event, payload): Promise<void> {
      const state = rooms.get(roomId)
      if (state === undefined) return Promise.resolve()
      fanout(state, {
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
      fanout(state, {
        type: 'presence-changed',
        connectionId,
        presence: next,
      })
      return Promise.resolve()
    },

    getPresence(roomId): Promise<Record<string, Presence>> {
      const state = rooms.get(roomId)
      if (state === undefined) return Promise.resolve({})
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
        gcIfEmpty(roomId, state)
      }
    },

    async applyYjsUpdate(roomId, connectionId, bytes): Promise<void> {
      // #194: the oversized check MUST precede the inflight++ — it throws with
      // no surrounding finally, so incrementing first would leak a refcount.
      if (bytes.byteLength > maxUpdateBytes) {
        throw new RealtimeError(
          `Y.Doc update size ${bytes.byteLength}B exceeds maxUpdateBytes ${maxUpdateBytes}B`,
          { code: 'yjs_update_oversized' },
        )
      }
      const state = rooms.get(roomId)
      if (state === undefined) return
      // #194: claim the room BEFORE the await (atomic — no await between rooms.get
      // and this line) so gcIfEmpty defers while we operate; release in finally.
      state.inflight += 1
      try {
        // #196: ensureYjs returns the loaded module in the bundle — no redundant loadYjs.
        const { doc, yjs } = await ensureYjs(roomId, state)
        // #194 belt: if the room was evicted mid-op (only possible without the
        // refcount we hold — i.e. defensive), skip the apply (safe no-op) rather
        // than touch a destroyed doc.
        if (rooms.get(roomId) !== state) return
        yjs.applyUpdate(doc, bytes, connectionId)
        // #53: applying to the server doc told nobody. Without this fanout a CRDT edit
        // reaches the author's own screen and no other client ever — and the base64
        // branch of `frameToOutput` was unreachable code, since nothing produced the
        // frame it converts.
        //
        // The received bytes are rebroadcast rather than `Y.encodeStateAsUpdate(doc)`:
        // O(update) instead of O(document) per keystroke, and it is what y-websocket
        // does. A client joining mid-session therefore needs an initial sync, which is a
        // separate concern from propagating a live edit.
        //
        // The author is NOT excluded. `fanout` has no listener→connectionId map, and
        // adding one to save the author's own bytes would buy bandwidth with structure;
        // Yjs is idempotent, so re-applying your own update is harmless. The frame
        // carries `connectionId` precisely so a consumer can skip its own.
        fanout(state, { type: 'yjs-update', connectionId, bytes })
      } finally {
        state.inflight -= 1
        gcIfEmpty(roomId, state)
      }
    },

    async applyYjsAwareness(roomId, connectionId, bytes): Promise<void> {
      // #194: oversized check precedes inflight++ (throws without a finally).
      if (bytes.byteLength > maxUpdateBytes) {
        throw new RealtimeError(
          `Y.Awareness update size ${bytes.byteLength}B exceeds maxUpdateBytes ${maxUpdateBytes}B`,
          { code: 'y_awareness_oversized' },
        )
      }
      const state = rooms.get(roomId)
      if (state === undefined) return
      state.inflight += 1
      try {
        // #196: ensureYjs returns the loaded module in the bundle — no redundant loadYjs.
        const { awareness, awMod } = await ensureYjs(roomId, state)
        if (rooms.get(roomId) !== state) return
        awMod.applyAwarenessUpdate(awareness, bytes, connectionId)
        // #53: same omission as applyYjsUpdate — awareness (cursors, selections) was
        // applied server-side and never propagated, so remote cursors never appeared.
        fanout(state, { type: 'yjs-awareness', connectionId, bytes })
      } finally {
        state.inflight -= 1
        gcIfEmpty(roomId, state)
      }
    },
  }
}

/** Re-export for callers wanting structural types inline. */
export type { ConnectionInfo, BroadcastPayload }
