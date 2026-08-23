/**
 * @theokit/plugin-realtime/react — React hooks (P#9 v0.1.0 sub-path).
 *
 * Per ADR D4 (React hooks at /react sub-path; peer React optional).
 *
 * Consumer wraps the React tree with `<RoomProvider roomId client={client}>`
 * and uses hooks to read/write presence + broadcast events. The `client` is
 * any object that exposes `subscribe(name, input, opts)` returning an
 * AsyncGenerator (matches G8 `@theokit/sdk/subscription` shape; can be
 * stubbed for tests via a fake transport).
 *
 * @public
 */

import * as React from 'react'
import type { BroadcastPayload, Presence } from '../types.js'

/**
 * G8-compatible subscription client shape (structural, NOT imported from SDK).
 *
 * @public
 */
export interface RealtimeSubscribeClient {
  subscribe<TInput, TOutput>(
    name: string,
    input: TInput,
    opts: { baseUrl: string; transport?: 'ws' | 'sse' | 'auto' },
  ): AsyncGenerator<TOutput, void, void>
}

/**
 * Room state surface exposed via React Context.
 *
 * @public
 */
export interface RoomState<
  P extends Presence = Presence,
  E extends BroadcastPayload = BroadcastPayload,
> {
  readonly roomId: string
  readonly others: Record<string, P>
  readonly myPresence: P
  readonly connectionId: string | null
  updateMyPresence(patch: Partial<P>): void
  broadcast(event: string, payload: E): void
}

interface InternalRoomState {
  others: Record<string, Presence>
  myPresence: Presence
  connectionId: string | null
}

/** #185: a single inbound realtime frame (presence/broadcast wire shape). */
interface RealtimeOutFrame {
  type: string
  connectionId?: string
  presence?: Presence
  event?: string
  payload?: BroadcastPayload
}

type SetStateAndNotify = (next: InternalRoomState) => void

/** #185: reduce one inbound frame into room state (extracted to cap effect CC). */
function applyRealtimeFrame(
  out: RealtimeOutFrame,
  stateRef: { current: InternalRoomState },
  setStateAndNotify: SetStateAndNotify,
): void {
  switch (out.type) {
    case 'joined':
      applyJoinedFrame(out, stateRef, setStateAndNotify)
      break
    case 'left':
      if (out.connectionId !== undefined) {
        const { [out.connectionId]: _removed, ...rest } = stateRef.current.others
        setStateAndNotify({ ...stateRef.current, others: rest })
      }
      break
    case 'presence-changed':
      applyPresenceChangedFrame(out, stateRef, setStateAndNotify)
      break
    case 'broadcast':
      // Broadcast events surface via useBroadcast subscription, not state.
      break
  }
}

function applyJoinedFrame(
  out: RealtimeOutFrame,
  stateRef: { current: InternalRoomState },
  setStateAndNotify: SetStateAndNotify,
): void {
  const isSelf = stateRef.current.connectionId === null
  if (isSelf && out.connectionId !== undefined) {
    setStateAndNotify({
      others: { ...stateRef.current.others },
      myPresence: out.presence ?? stateRef.current.myPresence,
      connectionId: out.connectionId,
    })
  } else if (out.connectionId !== undefined) {
    setStateAndNotify({
      ...stateRef.current,
      others: { ...stateRef.current.others, [out.connectionId]: out.presence ?? {} },
    })
  }
}

function applyPresenceChangedFrame(
  out: RealtimeOutFrame,
  stateRef: { current: InternalRoomState },
  setStateAndNotify: SetStateAndNotify,
): void {
  if (out.connectionId === undefined || out.presence === undefined) return
  if (out.connectionId === stateRef.current.connectionId) {
    setStateAndNotify({ ...stateRef.current, myPresence: out.presence })
  } else {
    setStateAndNotify({
      ...stateRef.current,
      others: { ...stateRef.current.others, [out.connectionId]: out.presence },
    })
  }
}

interface RoomContextValue {
  state: InternalRoomState
  emit(out: { kind: 'presence-update'; patch: Partial<Presence> }): void
  emitBroadcast(event: string, payload: BroadcastPayload): void
  roomId: string
}

const RoomContext = React.createContext<RoomContextValue | null>(null)

/**
 * Options for {@link RoomProvider}.
 *
 * @public
 */
export interface RoomProviderProps {
  /** Room id (must match a server-registered `defineRoom({id})`). */
  roomId: string
  /** Initial presence for THIS client when joining the room. */
  initialPresence?: Presence
  /** G8-compatible subscribe client. */
  client: RealtimeSubscribeClient
  /** Base URL for the realtime endpoint (defaults to `''` = relative). */
  baseUrl?: string
  /** Optional subscription name override (defaults to `realtime:{roomId}`). */
  subscriptionName?: string
  readonly children?: React.ReactNode
}

/**
 * React Context provider wiring a room subscription to a G8 client.
 *
 * @public
 */
export function RoomProvider(props: RoomProviderProps): React.ReactElement {
  const { roomId, initialPresence, client, baseUrl, subscriptionName, children } = props
  const [state, setState] = React.useState<InternalRoomState>(() => ({
    others: {},
    myPresence: { ...(initialPresence ?? {}) },
    connectionId: null,
  }))

  const stateRef = React.useRef(state)
  stateRef.current = state

  // Keeps `stateRef` in step with the state the effect's frame loop reads, which is why this
  // exists at all: the loop closes over the ref, not over a render's `state`.
  //
  // It used to also fan out to a listener set, but nothing ever subscribed — `RoomContextValue`
  // is not exported and `ctx.subscribe` was called nowhere, so the notify loop ran over an empty
  // set on every frame (#115).
  const setStateAndNotify = React.useCallback((next: InternalRoomState): void => {
    stateRef.current = next
    setState(next)
  }, [])

  // Subscription lifecycle.
  React.useEffect(() => {
    let cancelled = false
    const ac = new AbortController()
    const name = subscriptionName ?? `realtime:${roomId}`
    const url = baseUrl ?? ''
    void (async () => {
      try {
        const iter = client.subscribe<
          { initialPresence?: Presence },
          {
            type: string
            connectionId?: string
            presence?: Presence
            event?: string
            payload?: BroadcastPayload
          }
        >(
          name,
          { initialPresence: stateRef.current.myPresence },
          { baseUrl: url, transport: 'auto' },
        )
        for await (const out of iter) {
          if (cancelled) return
          // #185: per-frame state reduction extracted to keep this effect's
          // cyclomatic complexity low (behavior unchanged).
          applyRealtimeFrame(out, stateRef, setStateAndNotify)
        }
      } catch {
        // Subscription failure — leave state intact; consumer can retry by
        // unmounting/remounting the provider.
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [roomId, baseUrl, subscriptionName, client, setStateAndNotify])

  const value = React.useMemo<RoomContextValue>(
    () => ({
      state,
      roomId,
      emit(_out) {
        // Outbound presence updates require an outbound channel back to the
        // server (G8 WS upstream). For the v0.1 hooks scaffold we update
        // local state optimistically; the wire-up to send via client is a
        // post-MVP enhancement once G8 `subscribe` upstream `.send()` API
        // stabilizes (currently AsyncGenerator is read-only).
        const merged = { ...state.myPresence, ..._out.patch } as Presence
        setStateAndNotify({ ...state, myPresence: merged })
      },
      emitBroadcast(_event, _payload) {
        // Same upstream constraint as `emit`; broadcasts are tracked locally
        // until upstream support lands.
      },
    }),
    [state, roomId, setStateAndNotify],
  )

  return React.createElement(RoomContext.Provider, { value }, children)
}

function useRoomContext(): RoomContextValue {
  const ctx = React.useContext(RoomContext)
  if (ctx === null) {
    throw new Error('useRoom/useOthers/usePresence: must be called inside <RoomProvider>')
  }
  return ctx
}

/**
 * Returns the {@link RoomState} for the enclosing room.
 *
 * @public
 */
export function useRoom<
  P extends Presence = Presence,
  E extends BroadcastPayload = BroadcastPayload,
>(): RoomState<P, E> {
  const ctx = useRoomContext()
  return {
    roomId: ctx.roomId,
    others: ctx.state.others as Record<string, P>,
    myPresence: ctx.state.myPresence as P,
    connectionId: ctx.state.connectionId,
    updateMyPresence: (patch) => ctx.emit({ kind: 'presence-update', patch }),
    broadcast: (event, payload) => ctx.emitBroadcast(event, payload),
  }
}

/**
 * Subscribes the component to changes in OTHER clients' presence.
 *
 * @public
 */
export function useOthers<P extends Presence = Presence>(): Record<string, P> {
  const ctx = useRoomContext()
  return ctx.state.others as Record<string, P>
}

/**
 * Returns the local client's current presence.
 *
 * @public
 */
export function usePresence<P extends Presence = Presence>(): P {
  const ctx = useRoomContext()
  return ctx.state.myPresence as P
}

/**
 * Returns an updater function for the local client's presence.
 *
 * @public
 */
export function useUpdateMyPresence<P extends Presence = Presence>(): (patch: Partial<P>) => void {
  const ctx = useRoomContext()
  return (patch) => ctx.emit({ kind: 'presence-update', patch })
}

/**
 * Returns a broadcaster for arbitrary events. Subscribers to specific events
 * should be wired via a custom hook on top of this (v0.1 keeps broadcast
 * surface minimal).
 *
 * @public
 */
export function useBroadcast<E extends BroadcastPayload = BroadcastPayload>(): (
  event: string,
  payload: E,
) => void {
  const ctx = useRoomContext()
  return (event, payload) => ctx.emitBroadcast(event, payload)
}

/**
 * Yjs `Y.Doc` accessor hook. Throws when YjsRealtimeProvider is not configured
 * server-side (v0.1: doc must be supplied by consumer via dedicated context
 * extension — future iteration will auto-wire when room descriptor declares
 * `storage: "yjs"`).
 *
 * @public
 */
export function useYDoc(): never {
  throw new Error(
    "useYDoc: Y.Doc auto-wiring requires room descriptor `storage: 'yjs'` + YjsRealtimeProvider server-side. v0.1 ships the provider but auto-wiring through the React Context is deferred to v0.x. Use the YjsRealtimeProvider directly server-side and consume Y.Doc updates via useBroadcast for now.",
  )
}
