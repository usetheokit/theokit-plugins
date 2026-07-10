/**
 * @theokit/plugin-realtime — Server integration helper (P#9 internal).
 *
 * Per ADR D5 (G8 subscribe ONLY) + D3 (defineRoom factory) + D8 (Node v0.1).
 *
 * `mountRealtime` bridges a {@link RealtimeRuntime} to G8 `defineSubscription`
 * handlers. Consumer wires the returned subscription factories into
 * theokit/server (one per room id) — typically auto-mounted at
 * `/api/realtime/{roomId}`.
 *
 * The G8 SDK surface is referenced structurally (not imported) so this plugin
 * stays decoupled from the SDK version until @next publishes.
 *
 * @internal
 */

import { randomUUID } from "node:crypto";
import {
  type BroadcastPayload,
  type ConnectionInfo,
  type Presence,
  type RealtimeFrame,
  type RoomDescriptor,
  type ZodLike,
} from "../types.js";
import {
  type InboundWireFrame,
  RealtimeRuntime,
} from "./runtime.js";

/**
 * Subscription input shape — schema validated by G8 at the boundary.
 * Consumer's `defineSubscription({input: realtimeSubscriptionInput, ...})`
 * gates malformed frames.
 *
 * @public
 */
export interface RealtimeSubscriptionInput {
  /** Optional initial presence (validated server-side per room descriptor). */
  initialPresence?: Presence;
  /** Resume token (G8 lastEventId opaque cursor); not used for in-memory provider. */
  lastEventId?: string;
}

/**
 * Subscription output frame shape. Mirrors {@link RealtimeFrame} with the
 * binary Y.Doc / Awareness bytes encoded as base64 (so JSON wire is safe).
 *
 * @public
 */
export type RealtimeSubscriptionOutput =
  | { type: "joined"; connectionId: string; presence: Presence }
  | { type: "left"; connectionId: string }
  | { type: "presence-changed"; connectionId: string; presence: Presence }
  | {
      type: "broadcast";
      connectionId: string;
      event: string;
      payload: BroadcastPayload;
    }
  | { type: "yjs-update"; connectionId: string; bytes: string }
  | { type: "yjs-awareness"; connectionId: string; bytes: string };

/**
 * Max frames buffered per subscription before the connection is disconnected
 * (#195 bounded queue). A consumer that cannot keep up is dropped so it
 * reconnects and resyncs, rather than letting the server buffer grow unbounded.
 */
const MAX_QUEUED_FRAMES = 1024;

function encodeBytes(bytes: Uint8Array): string {
  // Buffer is available in Node + theokit's Node-canonical v0.1 deploy story.
  return Buffer.from(bytes).toString("base64");
}

function frameToOutput(frame: RealtimeFrame): RealtimeSubscriptionOutput {
  if (frame.type === "yjs-update" || frame.type === "yjs-awareness") {
    return {
      type: frame.type,
      connectionId: frame.connectionId,
      bytes: encodeBytes(frame.bytes),
    };
  }
  return frame;
}

/**
 * Structural ctx shape — mirrors G8's `SubscriptionCtx` (see @theokit/sdk
 * `subscription/types.ts:SubscriptionCtx`). Mocked here to avoid hard import
 * until @next publishes.
 *
 * @internal
 */
export interface MountedSubscriptionCtx {
  readonly signal: AbortSignal;
  readonly connectionId: string;
  readonly lastEventId?: string;
  disconnect(code?: number, reason?: string): void;
  tracked<TPayload>(id: string, payload: TPayload): readonly [id: string, payload: TPayload];
}

/**
 * Handler signature consumed by G8 `defineSubscription`.
 *
 * @public
 */
export type RealtimeSubscriptionHandler = (
  input: RealtimeSubscriptionInput,
  ctx: MountedSubscriptionCtx,
) => AsyncGenerator<RealtimeSubscriptionOutput, void, void>;

/**
 * Options accepted by {@link mountRealtime}.
 *
 * @public
 */
export interface MountRealtimeOptions {
  /** Pre-constructed runtime (with provider + rooms registered). */
  runtime: RealtimeRuntime;
  /** Rooms to expose via subscription handlers. Must be registered in runtime. */
  rooms: readonly RoomDescriptor[];
  /**
   * Optional schema for the wrapper subscription input (consumer can extend
   * with extra fields). Defaults to a basic schema accepting `initialPresence`
   * + `lastEventId`.
   */
  inputSchema?: ZodLike<RealtimeSubscriptionInput>;
}

/**
 * Returned by {@link mountRealtime}.
 *
 * @public
 */
export interface MountedRealtime {
  readonly runtime: RealtimeRuntime;
  /** Map of `roomId → defineSubscription opts` consumer feeds to G8. */
  readonly subscriptions: ReadonlyMap<
    string,
    {
      readonly name: string;
      readonly input: ZodLike<RealtimeSubscriptionInput>;
      readonly handler: RealtimeSubscriptionHandler;
    }
  >;
}

const passthroughInputSchema: ZodLike<RealtimeSubscriptionInput> = {
  safeParse(value) {
    if (value === null || typeof value !== "object") {
      return { success: true, data: {} };
    }
    return { success: true, data: value };
  },
  parse(value) {
    return (value ?? {});
  },
};

/**
 * Build per-room subscription handlers compatible with G8 `defineSubscription`.
 *
 * @public
 */
export function mountRealtime(opts: MountRealtimeOptions): MountedRealtime {
  if (opts === null || typeof opts !== "object") {
    throw new TypeError("mountRealtime: options object is required");
  }
  if (!(opts.runtime instanceof RealtimeRuntime)) {
    throw new TypeError("mountRealtime: opts.runtime must be a RealtimeRuntime");
  }
  const inputSchema = opts.inputSchema ?? passthroughInputSchema;
  const subscriptions = new Map<
    string,
    {
      name: string;
      input: ZodLike<RealtimeSubscriptionInput>;
      handler: RealtimeSubscriptionHandler;
    }
  >();

  for (const room of opts.rooms) {
    const name = `realtime:${room.id}`;
    opts.runtime.registerRoom(room);

    const handler: RealtimeSubscriptionHandler = async function* (input, ctx) {
      const connection: ConnectionInfo = {
        connectionId: ctx.connectionId ?? randomUUID(),
      };
      const queue: RealtimeSubscriptionOutput[] = [];
      let waiter: ((v: void) => void) | null = null;
      let stopped = false;

      const wake = (): void => {
        if (waiter !== null) {
          waiter();
          waiter = null;
        }
      };

      const onFrame = (frame: RealtimeFrame): void => {
        // #198: once aborted/stopped, drop frames instead of enqueuing — a
        // disconnected consumer must not keep growing the buffer.
        if (stopped) return;
        // #195: bound the queue. A consumer that never drains (slow/gone) would
        // otherwise grow it without limit (memory DoS). On overflow, stop and
        // disconnect so the client reconnects + resyncs rather than silently
        // losing CRDT frames.
        if (queue.length >= MAX_QUEUED_FRAMES) {
          stopped = true;
          wake();
          ctx.disconnect(1013, "realtime: server frame queue overflow");
          return;
        }
        queue.push(frameToOutput(frame));
        wake();
      };

      const onAbort = (): void => {
        stopped = true;
        wake();
      };

      // #195: an already-aborted signal at entry means nothing was acquired yet —
      // exit before handleConnection so there is no handle to leak. This guard
      // MUST stay BEFORE the addEventListener below: returning after registering
      // would leak the listener (nothing removes it on this early-return path).
      if (ctx.signal.aborted) return;
      // #195: register BEFORE `await handleConnection` so an abort DURING that
      // await is observed (addEventListener with {once} does NOT fire on a
      // signal that is already aborted, so registering after the await would
      // miss it and block the generator forever, leaking the handle).
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      let handle: Awaited<ReturnType<typeof opts.runtime.handleConnection>>;
      try {
        handle = await opts.runtime.handleConnection(
          room.id,
          connection,
          input.initialPresence,
          onFrame,
        );
      } catch (cause) {
        // Surface as error frame via G8 (the runtime fanned `joined` event
        // but handleConnection rejected — propagate so SDK emits error frame).
        ctx.signal.removeEventListener("abort", onAbort); // no listener leak on failure
        throw cause;
      }

      try {
        while (!stopped) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              waiter = resolve;
            });
            continue;
          }
          const next = queue.shift();
          if (next === undefined) continue;
          yield next;
        }
      } finally {
        // #195: release the handle AND drop the abort listener — both leak
        // per-connection without this (the listener outlives the generator).
        ctx.signal.removeEventListener("abort", onAbort);
        await handle.release();
      }
    };

    subscriptions.set(room.id, { name, input: inputSchema, handler });
  }

  return {
    runtime: opts.runtime,
    subscriptions,
  };
}
