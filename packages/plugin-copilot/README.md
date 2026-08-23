# @theokit/plugin-copilot

> AI Copilot pattern for TheoKit — `defineCopilot` factory + `AgentRoomMember` (P#9 RoomMember) + `CopilotRuntime` orchestrator + React hooks family + `<CopilotChat />` composição. Form 4 Hybrid per plan `p11-plugin-copilot` v1.0.

**Differentiator from CopilotKit:** the copilot is a first-class participant in the realtime room — every human in the room sees the copilot's `name`, `avatar`, `color`, and `typing` status in the presence Map. Multiple copilots can coexist in the same room with policy-driven dispatch (`first-wins` / `round-robin` / `all` / custom function).

Integration plugin — composes `@theokit/sdk` Agent + `@theokit/plugin-realtime` (P#9) + optional `@theokit/plugin-rate-limit` (P#10) + opt-in `@theokit/plugin-canvas` + `@theokit/plugin-voice` + opt-in `@theokit/ui` composites. Structural type mirrors avoid hard imports of peers — the plugin compiles standalone and resolves peers at runtime.

## Install

```bash
pnpm add @theokit/plugin-copilot @theokit/sdk @theokit/plugin-realtime theokit
# Optional rate-limit guard (P#10):
pnpm add @theokit/plugin-rate-limit
# Optional Zod schemas for room.presence / room.broadcast:
pnpm add zod
# Optional React peer for the /react sub-path:
pnpm add react react-dom
# Optional UI composites — @theokit/ui for AI chat surfaces
# (<CopilotChat /> builds on ChatComposer/ChatMessage/ChatThread);
# add @usetheo/ui too if you wire the usage-meter (getUsage) into
# generic primitives (MetricCard/StatTile), which moved there:
pnpm add @theokit/ui
pnpm add @usetheo/ui  # only if using generic primitives (usage-meter, etc.)
# Opt-in capability integrations:
pnpm add @theokit/plugin-voice  # voice STT/TTS
pnpm add @theokit/plugin-canvas # canvas artifact emission
```

## Quick start

Two steps, and the second is the one people miss.

**1. Register the plugin.** `copilot()` returns a `TheoPlugin`; it goes into `theo.config.ts` like
any other. Without this the package's request surface is never installed — `ctx.copilot` is
undefined and nothing says why, because an unregistered plugin looks exactly like a plugin nobody
wrote.

<!-- doc-example: needs="./app/copilots/support.js" -->

```ts
// theo.config.ts
import {
  copilot,
  type CopilotAgentLike,
  type CopilotRealtimeProvider,
} from '@theokit/plugin-copilot'
import { config } from 'theokit'

import support from './app/copilots/support.js'

// The two you supply: a realtime transport, and anything with `Agent.streamObject`.
declare const myRealtimeProvider: CopilotRealtimeProvider
declare const myAgent: CopilotAgentLike

export default config()
  .set({
    plugins: [
      copilot({
        provider: myRealtimeProvider,
        agent: myAgent,
        copilots: [support],
      }),
    ],
  })
  .build()
```

**2. Define a copilot.** `defineCopilot` describes one bot; the file's default export is what step
1 hands to the plugin.

```ts
// app/copilots/support.ts
import { defineCopilot } from '@theokit/plugin-copilot'
import { z } from 'zod'

export default defineCopilot({
  id: 'support-bot',
  room: {
    id: 'support-room',
    presence: z.object({
      name: z.string().optional(),
      cursor: z.tuple([z.number(), z.number()]).optional(),
    }),
    broadcast: z.object({
      kind: z.enum(['question', 'answer', 'tool-call']).optional(),
      text: z.string().optional(),
    }),
  },
  agent: {
    name: 'SupportBot',
    model: 'openai/gpt-4o-mini',
    systemPrompt: 'You are SupportBot. Be concise and helpful.',
  },
  identity: {
    name: 'Support Bot',
    avatar: '/avatars/support.png',
    color: '#7c3aed',
  },
  triggers: [
    { on: 'broadcast:question', action: 'respond' },
    { on: 'presence:idle', action: 'suggest', idleMs: 30_000 },
  ],
  budget: {
    perRoom: {
      perRequestUsd: 0.01,
      dailyUsd: 1.0,
    },
  },
})
```

<!-- doc-example: needs="./copilots/support.js" -->

```ts
// server bootstrap
import { Agent } from '@theokit/sdk'
import { createMemoryRealtimeProvider } from '@theokit/plugin-realtime'
import { CopilotRuntime } from '@theokit/plugin-copilot'
import supportCopilot from './copilots/support.js'

const provider = createMemoryRealtimeProvider()

// Bridge SDK Agent (static methods) to CopilotAgentLike (instance shape).
const agent = {
  async *streamObject(opts: {
    schema: unknown
    prompt: string
    model: string | { id: string }
    systemPrompt?: string
  }) {
    const modelSel = typeof opts.model === 'string' ? { id: opts.model } : opts.model
    const sys = opts.systemPrompt ?? ''
    const fullPrompt = sys ? `${sys}\n\n${opts.prompt}` : opts.prompt
    const result = await Agent.prompt(fullPrompt, {
      model: modelSel,
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
      local: { settingSources: [] },
      providers: {
        routes: [{ capability: 'chat', provider: 'openrouter' }],
        fallback: ['openrouter'],
      },
    })
    if (result.status !== 'finished') {
      throw new Error(`Agent failed: ${JSON.stringify((result as { error?: unknown }).error)}`)
    }
    const text = typeof result.result === 'string' ? result.result : ''
    yield { type: 'partial', partial: { text }, attempt: 0 } as const
    yield { type: 'complete', object: { text } } as const
  },
}

const runtime = new CopilotRuntime({
  provider,
  agent,
  copilots: [supportCopilot],
  estimatedCostPerInvocationUsd: 0.001,
})

await runtime.activate('support-bot')
```

## React composição

<!-- doc-example: needs="./bootstrap" -->

```tsx
// app/page.tsx
import {
  CopilotProvider,
  CopilotChat,
  useCopilot,
  useCopilotPresence,
} from '@theokit/plugin-copilot/react'
import { provider } from './bootstrap'

export default function Page() {
  return (
    <CopilotProvider
      roomId="support-room"
      copilotId="support-bot"
      provider={provider}
      userConnectionId="alice"
    >
      <CopilotChat />
    </CopilotProvider>
  )
}
```

Or use the headless hooks family for full theme control:

```tsx
import {
  useCopilotMessages,
  useCopilotPresence,
  useCopilotTyping,
  useCopilotReadable,
  useCopilotTool,
} from '@theokit/plugin-copilot/react'

function MyCustomChat() {
  const messages = useCopilotMessages()
  const presence = useCopilotPresence() // human peers (filtered)
  const typing = useCopilotTyping() // {copilotId, progress?} | null
  useCopilotReadable({ description: 'currentPage', value: { url: '/dashboard' } }) // broadcasts context to copilot
  useCopilotTool({
    name: 'create-task',
    description: 'Create a task',
    handler: async (args) => {
      /* … */
    },
  }) // exposes a tool to copilot
  // …render however you want
}
```

## Triggers — when the copilot acts

Three declarative trigger families per ADR D3:

| Trigger             | When it fires                                         | Action types                           |
| ------------------- | ----------------------------------------------------- | -------------------------------------- |
| `broadcast:<event>` | Any human broadcasts a frame with `event === <event>` | `respond` / `execute-tool`             |
| `presence:idle`     | No human activity in the room for `idleMs`            | `suggest`                              |
| `custom`            | Custom filter function returns `true` for a frame     | `respond` / `suggest` / `execute-tool` |

The CopilotRuntime filters out frames originating from any connection id starting with `copilot:` BEFORE evaluating triggers (EC-4 + EC-8 — cost-runaway and copilot impersonation guards).

## Multi-copilot per room — dispatcher policy (ADR D6)

When multiple copilots are registered in the same room, the `dispatcher` field of each `CopilotDescriptor` (or `defaultDispatcher` on the runtime) decides who responds:

| Policy                          | Behaviour                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `"first-wins"` _(default)_      | Only the first registered copilot in the room responds. Prevents cost runaway by default. |
| `"round-robin"`                 | Cursor cycles through copilots one frame at a time.                                       |
| `"all"`                         | Every copilot in the room responds to every triggering frame. Opt-in only — expensive.    |
| `(copilots, frame) => string[]` | Custom function returns the array of copilot ids that should respond.                     |

## Budget integration — opt-in cost guard (ADR D7)

Each copilot can declare `budget.perRoom: { perRequestUsd, dailyUsd, monthlyUsd }`. Before each agent invocation, the runtime runs a preflight against the rolling daily + monthly windows. On budget exceeded, the copilot broadcasts a typed `budget-exceeded` frame to the room instead of invoking the agent:

```json
{
  "type": "broadcast",
  "connectionId": "copilot:support-bot",
  "event": "budget-exceeded",
  "payload": {
    "message": "Per-request budget exceeded: $0.05 limit, would consume $0.10",
    "code": "budget_per_request_exceeded"
  }
}
```

`runtime.getUsage(copilotId)` returns `{ dailyUsedUsd, monthlyUsedUsd }` for usage-meter integration (`@usetheo/ui` `MetricCard` / `StatTile`).

## Custom provider (Liveblocks / PartyKit / Redis / TheoCloud)

```ts
import { defineCopilotRealtimeProvider } from '@theokit/plugin-copilot'

const myProvider = defineCopilotRealtimeProvider({
  async joinRoom(roomId, conn, initialPresence) {
    /* ... */
  },
  async leaveRoom(roomId, connectionId) {
    /* ... */
  },
  async broadcast(roomId, connectionId, event, payload) {
    /* ... */
  },
  async updatePresence(roomId, connectionId, patch) {
    /* ... */
  },
  async getPresence(roomId) {
    return {}
  },
  subscribeRoom(roomId, listener) {
    return () => {}
  },
})
```

The helper validates that all 6 required methods are present at construction.

## Security threats addressed

| Threat                                                                                    | Mitigation                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cost runaway** via copilot loop (copilot A triggers copilot B which triggers copilot A) | `TriggerEvaluator` filters out frames where `connectionId.startsWith("copilot:")` BEFORE matching triggers (EC-4). Default dispatcher `"first-wins"` further bounds same-room cost.                                                                                                 |
| **Copilot impersonation** by a malicious human client                                     | The `copilot:` connection-id prefix is reserved; humans cannot claim a `copilot:*` connection id when joining via the realtime layer (EC-8 — enforced by the consumer's wire layer; the copilot runtime never accepts a frame from a `copilot:*` connectionId as a trigger source). |
| **Per-request cost spike** (large prompt, model hallucination loop)                       | Optional `budget.perRoom.perRequestUsd` preflight — exceeds emit typed `budget-exceeded` frame instead of invoking the agent.                                                                                                                                                       |
| **Rolling daily / monthly cost overrun**                                                  | `budget.perRoom.{dailyUsd, monthlyUsd}` rolling windows reset at UTC day / month boundaries.                                                                                                                                                                                        |
| **Tool/knowledge registry injection** via React hooks                                     | `useCopilotReadable` / `useCopilotTool` broadcast register / deregister events scoped to the local connection; the copilot runtime decides whether to use them — never assumes trust.                                                                                               |
| **Trigger ReDoS** via malicious `broadcast:` event names                                  | Trigger event names are matched via exact-string equality (no regex). Custom-filter triggers run in the consumer's process — consumer responsibility.                                                                                                                               |

## Comparison vs CopilotKit

| Feature                    | CopilotKit                            | @theokit/plugin-copilot                                                                       |
| -------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Frontend SDK               | ✓ extensive (React + custom)          | ✓ React hooks family + `<CopilotChat />`                                                      |
| Agent runtime              | bridge via runtime tier (AG-UI)       | direct binding to `@theokit/sdk` `Agent.streamObject` / `Agent.prompt`                        |
| Tool registration          | `useCopilotAction`                    | `useCopilotTool` (registers via broadcast event)                                              |
| Context registration       | `useCopilotReadable`                  | `useCopilotReadable` (registers via broadcast event)                                          |
| **Multi-user awareness**   | ✗ copilot is invisible to other users | ✓ copilot is a `RoomMember` — visible in presence Map with name + avatar + color + typing     |
| Multi-copilot in same room | ✗                                     | ✓ dispatcher policy: `first-wins` / `round-robin` / `all` / custom fn                         |
| Budget per-room            | ✗                                     | ✓ `perRequestUsd` + `dailyUsd` + `monthlyUsd` rolling windows + typed `budget-exceeded` frame |
| Provider abstraction       | ✗ specific runtime                    | ✓ any P#9 `RealtimeProvider` (Memory + Yjs + Liveblocks + PartyKit + TheoCloud)               |
| Voice (STT + TTS)          | ✗                                     | opt-in via `@theokit/plugin-voice` peer                                                       |
| Canvas (artifacts)         | ✗                                     | opt-in via `@theokit/plugin-canvas` peer                                                      |

## License

MIT.
