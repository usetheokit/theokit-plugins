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
 * Apply one inbound Yjs frame to the document, if there is one to apply it to.
 *
 * Awareness frames are accepted and ignored: both kinds are routed so neither reaches the reducer,
 * but only the document has a destination today. Treating an awareness frame as an error would
 * make a correctly-behaving server look broken.
 */
async function applyYjsFrame(
  type: 'yjs-update' | 'yjs-awareness',
  encoded: string | undefined,
  doc: RealtimeYDoc | undefined,
): Promise<void> {
  if (doc === undefined || type === 'yjs-awareness') return
  if (encoded === undefined) {
    throw new Error('plugin-realtime: a yjs-update frame arrived with no `bytes`.')
  }
  const bytes = decodeBase64(encoded)
  const yjs = await loadYjs()
  yjs.applyUpdate(doc, bytes, REMOTE_ORIGIN)
}

/**
 * The shape of a Yjs document, described rather than imported.
 *
 * `yjs` is an OPTIONAL peer of this package: most consumers use it for presence and broadcast and
 * never touch a CRDT, and a static import would make a CRDT library mandatory for all of them.
 * `src/yjs-provider.ts` already solves this server-side with structural types plus a lazy
 * `import('yjs')`; this is the same technique on the client.
 *
 * It is a SEPARATE declaration from the server's `YDocLike`, deliberately. The server needs
 * `destroy()`; the client needs the update event. One shape covering both would over-demand of
 * each caller — a document passed here would have to prove it can be destroyed, which this half
 * never does.
 *
 * A real `Y.Doc` satisfies this structurally.
 *
 * @public
 */
export interface RealtimeYDoc {
  on(event: 'update', handler: (update: Uint8Array, origin: unknown) => void): void
  off(event: 'update', handler: (update: Uint8Array, origin: unknown) => void): void
}

/**
 * Origin stamped on updates this package applied from the wire.
 *
 * Without it the local `update` listener fires for every frame just received and sends it straight
 * back, so two clients saturate each other.
 *
 * `Symbol.for` rather than `Symbol()` deliberately, and NOT for privacy — the global registry is
 * the opposite of private, and an earlier version of this comment claimed it was. The reason is
 * that two copies of this module (a duplicated install, a bundler that does not dedupe) must agree
 * on the sentinel, or one copy's applied update looks local to the other and echoes.
 */
const REMOTE_ORIGIN = Symbol.for('@theokit/plugin-realtime#remote')

/**
 * Encode Yjs bytes for a JSON transport.
 *
 * The mirror of `decodeBase64`, and the reason it exists: `RealtimeSendClient.send` used to be
 * handed a raw `Uint8Array`, and the README's own canonical transport is
 * `socket.send(JSON.stringify(frame))`. `JSON.stringify(new Uint8Array([1,2]))` yields
 * `{"0":1,"1":2}`, which `Y.applyUpdate` rejects — so the headline feature did not work over the
 * one transport the package documents.
 *
 * `btoa` in a browser, `Buffer` in Node, same order as the decode.
 */
function encodeBase64(bytes: Uint8Array): string {
  const globals = globalThis as { btoa?: (s: string) => string; Buffer?: typeof Buffer }
  if (typeof globals.btoa === 'function') {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return globals.btoa(binary)
  }
  if (globals.Buffer !== undefined) return globals.Buffer.from(bytes).toString('base64')
  throw new Error(
    'plugin-realtime: cannot encode a Yjs frame — this environment provides neither `btoa` nor `Buffer`.',
  )
}

/** Decode the base64 the wire carries (`server-integration.ts` encodes with `Buffer`). */
function decodeBase64(encoded: string): Uint8Array {
  // `atob` in a browser, `Buffer` in Node. Reusing the server's `Buffer.from` alone would crash on
  // the one surface this file always runs in.
  const globals = globalThis as { atob?: (s: string) => string; Buffer?: typeof Buffer }
  if (typeof globals.atob === 'function') {
    const binary = globals.atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  if (globals.Buffer !== undefined) {
    return new Uint8Array(globals.Buffer.from(encoded, 'base64'))
  }
  throw new Error(
    'plugin-realtime: cannot decode a Yjs frame — this environment provides neither `atob` nor `Buffer`.',
  )
}

interface YjsApplyModule {
  applyUpdate(doc: RealtimeYDoc, update: Uint8Array, origin?: unknown): void
}

let pendingYjs: Promise<YjsApplyModule> | null = null

/** Load the optional peer on first use, and name it when it is not installed. */
function loadYjs(): Promise<YjsApplyModule> {
  pendingYjs ??= import('yjs').then(
    (mod) => mod as unknown as YjsApplyModule,
    (cause: unknown) => {
      pendingYjs = null
      throw new Error(
        'plugin-realtime: `yjs` is an optional peer dependency and could not be loaded. Install `yjs` to use useYDoc().',
        { cause },
      )
    },
  )
  return pendingYjs
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
  /** The document this provider was given, if any (B-011). */
  ydoc?: RealtimeYDoc
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
  /**
   * Optional Yjs document to wire to this room.
   *
   * The consumer constructs it — anyone who wants a `Y.Doc` already has `yjs` installed, and this
   * keeps the peer optional for everyone else. Omitted, `useYDoc()` refuses and nothing about the
   * room changes, so the prop is additive on a published package by construction.
   *
   * The room's descriptor must declare `storage: 'yjs'` server-side; the server refuses CRDT
   * frames for a room that does not, because the descriptor lives there and a client is not a
   * trust boundary.
   */
  ydoc?: RealtimeYDoc
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
  const { roomId, initialPresence, client, sender, ydoc, baseUrl, subscriptionName, children } =
    props
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
  // Read through a ref inside the subscription loop. Putting `ydoc` in that effect's dependency
  // list made DOCUMENT IDENTITY govern the ROOM SUBSCRIPTION lifetime: a consumer who passes an
  // inline `new Y.Doc()` re-subscribed on every parent render — measured at 6 subscribe() calls
  // after 5 re-renders — and each re-subscribe is a rejoin with presence churn. The stable-document
  // guidance belongs in the docs (and now in the hook's error message), but the failure mode
  // should not be this severe when it is ignored.
  const ydocRef = React.useRef(ydoc)
  ydocRef.current = ydoc

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
            // The wire carries the two Yjs kinds' payload as base64, not as bytes — see
            // `server-integration.ts`'s `encodeBytes`. Omitting this field is why the frames were
            // unreachable through the type as well as unhandled at runtime.
            bytes?: string
          }
        >(
          name,
          { initialPresence: stateRef.current.myPresence },
          { baseUrl: url, transport: 'auto' },
        )
        for await (const out of iter) {
          if (cancelled) return
          if (out.type === 'yjs-update' || out.type === 'yjs-awareness') {
            // Its OWN try, deliberately. The outer `catch` below exists to survive a transport
            // failure and cannot tell one from a bad frame, so letting a decode error reach it
            // would end presence AND broadcast for the whole room over one corrupt payload.
            // A bad frame costs one frame.
            try {
              await applyYjsFrame(out.type, out.bytes, ydocRef.current)
            } catch (error) {
              // Reported, not swallowed. There is no error channel on this API today, so the
              // console is where a browser-side library says something went wrong.
              console.error('plugin-realtime: dropping a Yjs frame', error)
            }
            continue
          }
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

  // The document's send half. Separate from the subscription effect because it has a different
  // lifetime: the subscription reconnects on a room change, this one detaches whenever the
  // document or the transport is swapped — and a listener that outlives its document writes the
  // previous room's edits into the next one.
  React.useEffect(() => {
    if (ydoc === undefined || sender === undefined) return

    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      // The frame we just applied from the wire fires this listener too. Without the origin
      // check it goes straight back out, and two clients saturate each other.
      if (origin === REMOTE_ORIGIN) return
      void sender.send({ kind: 'yjs-update', bytes: encodeBase64(update) })
    }

    ydoc.on('update', onUpdate)
    return () => ydoc.off('update', onUpdate)
  }, [ydoc, sender])

  const value = React.useMemo<RoomContextValue>(
    () => ({
      state,
      roomId,
      ydoc,
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
    [state, roomId, sender, setStateAndNotify, ydoc],
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
 * The room's Yjs document.
 *
 * Returns the document passed to `<RoomProvider ydoc={...}>`, wired to the room: inbound
 * `yjs-update` frames are applied to it, and local changes are sent through the `sender` port —
 * **when one is supplied**. With `ydoc` and no `sender` the document is receive-only and this hook
 * still succeeds, which is deliberate (it mirrors the presence and broadcast hooks) and worth
 * knowing, because a receive-only document looks synced and is not.
 *
 * Throws, naming the cause, when the provider was given no document. The other precondition — the
 * room declaring `storage: 'yjs'` — is enforced server-side, where the descriptor lives; a client
 * that sends CRDT frames to a room without it gets a typed refusal from the runtime.
 *
 * @public
 */
export function useYDoc(): RealtimeYDoc {
  const ctx = useRoomContext()
  if (ctx.ydoc === undefined) {
    // Names the missing prop, because that is what the caller can act on. The previous message
    // named a deferral ("auto-wiring is deferred to v0.x"), which told a consumer nothing they
    // could do — and by then the workaround it recommended was itself broken (see B-010).
    throw new Error(
      'useYDoc: this RoomProvider was given no `ydoc`. Pass a STABLE document — ' +
        '`const [doc] = React.useState(() => new Y.Doc())`, not `ydoc={new Y.Doc()}`, which is a ' +
        "new document on every render. Also declare `storage: 'yjs'` on the room's " +
        'defineRoom() server-side.',
    )
  }
  return ctx.ydoc
}
