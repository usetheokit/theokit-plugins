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
import type { InboundWireFrame } from '../internal/runtime.js'
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
 * A frame a client sends the server.
 *
 * This IS the server's own union — `InboundWireFrame` from `internal/runtime.ts`, re-exported
 * rather than restated. The first version hand-rolled a narrower copy carrying only
 * `presence-update` and `broadcast`, which meant two things: the duplicate had to be kept in step
 * by hand, and `yjs-update` / `yjs-awareness` could not travel the port at all — so a consumer
 * driving the shipped Yjs provider had no send side.
 *
 * `rules/parsimony-ladder.md` rung 4: the type was already declared and already public.
 *
 * @public
 */
export type RealtimeOutboundFrame = InboundWireFrame

/**
 * The send-side port — the mirror of {@link RealtimeSubscribeClient}.
 *
 * The hooks were given a receive-only client and never a send-side one, which is why presence and
 * broadcasts stayed local: not a missing channel, a missing port. The server half has always been
 * complete — `RealtimeRuntime` fans a validated broadcast out to every participant — and it is
 * deliberately transport-agnostic, so this side is too. A consumer supplies whatever reaches their
 * own endpoint: a WebSocket they own, a POST to their own route.
 *
 * Structural, and deliberately NOT imported from `@theokit/sdk`. Measured 2026-08-23:
 * `subscribe()` returns `AsyncGenerator<TOutput, void, void>` and the `./subscription` subpath
 * exports no outbound verb, so there is nothing upstream to import — by either route.
 *
 * @public
 */
export interface RealtimeSendClient {
  /**
   * Hand a frame to the transport.
   *
   * May return a promise. The README's own suggestion — "a POST to your own route" — is async, and
   * a `void` return silently swallowed its rejection: measured, an async sender produced one
   * unhandled rejection and nothing else while the local UI showed the update as applied.
   *
   * A rejection is the consumer's to handle. `useUpdateMyPresence` awaits nothing, so attach your
   * own `.catch` if a failed send should surface — the hook will not invent a retry or a rollback
   * policy for you.
   */
  send(frame: RealtimeOutboundFrame): void | Promise<void>
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
  /**
   * Optional outbound transport.
   *
   * Omitted, the hooks behave exactly as they did before this existed: `emit` merges into local
   * presence and `emitBroadcast` does nothing. The package is published, so the port is additive
   * by construction rather than by intention.
   */
  sender?: RealtimeSendClient
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
  const { roomId, initialPresence, client, sender, baseUrl, subscriptionName, children } = props
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
      emit(out) {
        // SEND FIRST, then merge. The order matters for a synchronous throw: merging first left
        // the local UI showing an update that was never sent — measured, exactly the "looks
        // synced and is not" this design cites as its reason. Sending first means a transport
        // that refuses loudly also prevents the false merge.
        //
        // Not wrapped in try/catch: a transport that is down is the consumer's to handle
        // (`rules/error-handling.md` § 2). An ASYNC rejection is a different case that no order
        // fixes — the merge has already happened when it arrives — and `RealtimeSendClient.send`
        // documents that as the consumer's to catch.
        void sender?.send({ kind: 'presence-update', patch: out.patch })
        // Optimistic, so the local UI does not lag its own input.
        //
        // The server echoes: `fanout` notifies every listener in the room including the sender.
        // But the echo is not a re-application of this patch — it carries the server's FULL
        // presence, and `applyPresenceChangedFrame` REPLACES `myPresence` with it. So the server
        // is authoritative, and a key this client set that the room's schema does not declare is
        // stripped when the echo lands. That is worth knowing and is not idempotence; an earlier
        // version of this comment claimed the patch was applied twice, and it is not.
        const merged = { ...state.myPresence, ...out.patch } as Presence
        setStateAndNotify({ ...state, myPresence: merged })
      },
      emitBroadcast(event, payload) {
        // Nothing local to do: a broadcast is other participants' state, not this client's. With
        // no sender this stays the no-op the README documents.
        void sender?.send({ kind: 'broadcast', event, payload })
      },
    }),
    [state, roomId, sender, setStateAndNotify],
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
