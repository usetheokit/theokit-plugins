# @theokit/plugin-realtime

> Multiplayer realtime plugin for TheoKit — presence + broadcast + Yjs CRDT (opt-in). Form 4 Hybrid per plan `p9-plugin-realtime` v1.0.

Built-in primitives for cursors, typing indicators, live counters, collaborative documents (Yjs). Consumes `@theokit/sdk/subscription` (G8) for the WebSocket transport. React hooks at the `/react` sub-path.

## Install

```bash
pnpm add @theokit/plugin-realtime @theokit/sdk theokit zod
# Optional CRDT peers (only needed if using YjsRealtimeProvider):
pnpm add yjs y-protocols
# Optional React peer (only needed if using the /react sub-path):
pnpm add react react-dom
```

## Quick start — Memory provider (single-node, dev)

```ts
// app/rooms/cursor.ts
import { defineRoom } from '@theokit/plugin-realtime'
import { z } from 'zod'

export default defineRoom({
  id: 'cursor',
  presence: z.object({
    cursor: z.tuple([z.number(), z.number()]).optional(),
    name: z.string().optional(),
  }),
  broadcast: z.object({
    kind: z.literal('ping'),
    ts: z.number(),
  }),
})
```

<!-- doc-example: needs="@theokit/sdk/subscription" needs="./app/rooms/cursor.js" partial -->

```ts
// server bootstrap
import {
  RealtimeRuntime,
  createMemoryRealtimeProvider,
  mountRealtime,
} from '@theokit/plugin-realtime'
import { defineSubscription } from '@theokit/sdk/subscription'
import cursorRoom from './app/rooms/cursor.js'

const provider = createMemoryRealtimeProvider()
const runtime = new RealtimeRuntime({ provider, rooms: [cursorRoom] })
const mounted = mountRealtime({ runtime, rooms: [cursorRoom] })

// Hand each `mounted.subscriptions.get(roomId)` config to defineSubscription:
for (const [roomId, sub] of mounted.subscriptions) {
  defineSubscription({
    input: sub.input,
    output: z.any(),
    handler: sub.handler,
  })
}
```

## React hooks (`@theokit/plugin-realtime/react`)

<!-- doc-example: needs="@theokit/sdk" -->

```tsx
import { RoomProvider, useOthers, useRoom } from '@theokit/plugin-realtime/react'
import { Theokit } from '@theokit/sdk'

function App() {
  return (
    <RoomProvider
      roomId="cursor"
      client={Theokit}
      initialPresence={{ name: 'Alice' }}
      baseUrl="http://localhost:3000"
    >
      <Cursors />
    </RoomProvider>
  )
}

function Cursors() {
  const { myPresence, updateMyPresence } = useRoom()
  const others = useOthers()
  return (
    <div onMouseMove={(e) => updateMyPresence({ cursor: [e.clientX, e.clientY] })}>
      <p>You: {JSON.stringify(myPresence)}</p>
      {Object.entries(others).map(([id, p]) => (
        <p key={id}>
          {id}: {JSON.stringify(p)}
        </p>
      ))}
    </div>
  )
}
```

Hooks available:

| Hook                       | Returns                                                                   | Notes                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `useRoom<P, E>()`          | `{roomId, others, myPresence, connectionId, updateMyPresence, broadcast}` | Throws outside `<RoomProvider>`                                                                                                           |
| `useOthers<P>()`           | `Record<connectionId, P>`                                                 | Read-only snapshot of other clients' presence                                                                                             |
| `usePresence<P>()`         | `P`                                                                       | Local client's current presence                                                                                                           |
| `useUpdateMyPresence<P>()` | `(patch: Partial<P>) => void`                                             | **Local-only unless a `sender` is supplied** — merges locally either way; with a sender, also sends a `presence-update` frame             |
| `useBroadcast<E>()`        | `(event: string, payload: E) => void`                                     | **Local-only in v0.1 unless a `sender` is supplied** — with no sender this is a no-op; with one, the server fans out to every participant |
| `useYDoc()`                | `Y.Doc`                                                                   | Throws in v0.1 — Y.Doc auto-wiring deferred to v0.x                                                                                       |

### Sending: the `sender` port

`RoomProvider` takes a receive-side `client` and an optional send-side `sender`. Supply one and the
hooks stop being local-only; supply nothing and behaviour is exactly what it was.

The port is deliberately transport-agnostic, because the server half is: `RealtimeRuntime` takes
whatever provider you run, and this side takes whatever transport you run. A WebSocket you own, a
POST to your own route — the plugin does not choose.

<!-- doc-example: needs="./my-transport.js" -->

```tsx
import {
  RoomProvider,
  type RealtimeSendClient,
  type RealtimeSubscribeClient,
} from '@theokit/plugin-realtime/react'

import { socket } from './my-transport.js'

// The receive side you already supply.
declare const subscribeClient: RealtimeSubscribeClient

const sender: RealtimeSendClient = {
  send: (frame) => socket.send(JSON.stringify(frame)),
}

export function Room({ children }: { children: React.ReactNode }) {
  return (
    <RoomProvider roomId="cursor" client={subscribeClient} sender={sender}>
      {children}
    </RoomProvider>
  )
}
```

**You wire both ends.** Nothing in this package calls `dispatchFrame` — a plugin cannot register a
route, so the inbound handler is yours. A `sender` that writes to a socket nobody reads sends into
nothing: on the server, hand what arrives to the runtime.

<!-- doc-example: needs="./my-server-socket.js" -->

```ts
import type { RealtimeRuntime } from '@theokit/plugin-realtime'

import { socket } from './my-server-socket.js'

// Yours: the runtime you constructed, and the ids this connection belongs to.
declare const runtime: RealtimeRuntime
declare const roomId: string
declare const connectionId: string

socket.on('message', (raw: string) => {
  void runtime.dispatchFrame(roomId, connectionId, JSON.parse(raw))
})
```

`dispatchFrame` validates against the room's schema before the provider fans out, so an invalid
patch fails with a named error rather than reaching other clients. A patch is merged over the
connection's current presence **before** validation, so a partial update is valid in a room whose
presence has required fields.

**Memoise the sender.** It is a dependency of the room context, so an inline
`sender={{ send: … }}` is a new identity on every parent render and re-renders every `useRoom`,
`useOthers` and `usePresence` consumer with it — measured at 6 consumer renders across 5 parent
renders, against 1 for a stable reference. Define it outside the component or wrap it in
`useMemo`.

**Your own frames come back.** The provider notifies every listener in the room, including the
sender. The echo is not a second application of your patch: it carries the server's **full**
presence and replaces your local copy with it.

So the server is authoritative, and that has a consequence worth knowing — a key you set that the
room's presence schema does not declare survives locally until the echo arrives, and is stripped
when it does. Declare every field you rely on.

## Yjs CRDT provider (opt-in)

```ts
import { createYjsRealtimeProvider, defineRoom } from '@theokit/plugin-realtime'
import { z } from 'zod'

const doc = defineRoom({
  id: 'doc',
  presence: z.object({ cursor: z.number().optional() }),
  broadcast: z.object({}),
  storage: 'yjs',
})

const provider = createYjsRealtimeProvider({ maxUpdateBytes: 1_048_576 })
```

Requires `yjs ^13` + `y-protocols ^1` peers. Dynamic `import('yjs')` keeps the SSR/server-only path zero-cost when CRDT isn't used.

## Custom provider (Liveblocks / PartyKit / Redis / CF DO)

```ts
import { defineRealtimeProvider, type RealtimeProvider } from '@theokit/plugin-realtime'

export const RedisRealtimeProvider = defineRealtimeProvider({
  name: 'redis',
  async joinRoom(roomId, conn) {
    /* publish join + add to set */
  },
  async leaveRoom(roomId, connectionId) {
    /* remove + publish leave */
  },
  async broadcast(roomId, conn, event, payload) {
    /* PUBLISH */
  },
  async updatePresence(roomId, conn, patch) {
    /* HSET + publish */
  },
  async getPresence(roomId) {
    /* HGETALL */ return {}
  },
  subscribeRoom(roomId, listener) {
    /* SUBSCRIBE */ return () => {}
  },
})
```

## Security threats addressed

| Threat                        | Mitigation                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthorized broadcast        | `defineRoom({authorize?: (ctx) => boolean})` per-room hook; G11 `defineAuth` runs at WS upgrade boundary before subscription dispatch               |
| Presence flooding (DoS)       | Consumer wires `@theokit/plugin-rate-limit` (P#10) middleware at G8 upgrade; SDK ships `RealtimeRuntime.getPresence()` for ops visibility           |
| Yjs update poisoning          | `YjsRealtimeProvider({maxUpdateBytes})` caps update size (default 1 MB); throws `RealtimeError({code:'yjs_update_oversized'})`                      |
| Y.Awareness oversized payload | Same `maxUpdateBytes` cap applies via `applyYjsAwareness`                                                                                           |
| PII leakage in presence       | Zod schema at `defineRoom` boundary validates fields; README recommends only opt-in non-sensitive fields                                            |
| Cross-room data leakage       | `RealtimeRuntime` enforces `roomId` scoping; provider methods cannot cross-room emit (multi-room isolation test in `tests/memory-provider.test.ts`) |

## Multi-runtime compatibility (v0.1)

| Runtime            | v0.1                                                   | v0.x (planned)                                                  |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------------- |
| Node 22+           | yes (canonical via G8 Node `ws` adapter)               | yes                                                             |
| Cloudflare Workers | consumer-supplied adapter via `defineRealtimeProvider` | yes (`@theokit/plugin-realtime-cloudflare` with DO hibernation) |
| Bun                | consumer-supplied adapter                              | yes                                                             |
| Deno               | consumer-supplied adapter                              | yes                                                             |

## License

MIT
