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

| Hook                       | Returns                                                                   | Notes                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `useRoom<P, E>()`          | `{roomId, others, myPresence, connectionId, updateMyPresence, broadcast}` | Throws outside `<RoomProvider>`                                                                               |
| `useOthers<P>()`           | `Record<connectionId, P>`                                                 | Read-only snapshot of other clients' presence                                                                 |
| `usePresence<P>()`         | `P`                                                                       | Local client's current presence                                                                               |
| `useUpdateMyPresence<P>()` | `(patch: Partial<P>) => void`                                             | **Local-only in v0.1** — updates local state optimistically but does not sync to the server yet               |
| `useBroadcast<E>()`        | `(event: string, payload: E) => void`                                     | **Local-only in v0.1** — events are scoped to the current client and do not fan out to other participants yet |
| `useYDoc()`                | `Y.Doc`                                                                   | Throws in v0.1 — Y.Doc auto-wiring deferred to v0.x                                                           |

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
