# `@theokit/plugin-canvas`

Canvas plugin for TheoKit — agent artifact protocol + side panel UI + agent custom tool.

Render 9 artifact kinds (markdown, code, svg, diff, whiteboard-scene, slide-deck, mermaid, html, image) inside an auto-opening side panel. Agents publish via the `publish_artifact` tool; the panel reacts in real time via SSE.

## Installation

```bash
pnpm add @theokit/plugin-canvas @usetheo/ui @theokit/ui
```

### Required peer dependencies

| Package        | Version            | Why                                                                                                           |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `@usetheo/ui`  | `>= 0.14.0`        | Generic UI primitives (`Button`, `Card`, `CopyButton`, `Tooltip`, `DropdownMenu`, `Alert`, `CodeBlock`, etc.) |
| `@theokit/ui`  | `>= 1.0.0`         | AI surfaces + engines (`DiffViewer`, `@theokit/ui/whiteboard`, `@theokit/ui/slide-deck`)                      |
| `@theokit/sdk` | `>= 1.0.0`         | Agent tool runtime / schema validation                                                                        |
| `theokit`      | `>= 0.1.0-alpha.5` | `defineAgentTool`, `defineAgentEndpoint`, route handlers                                                      |
| `react`        | `^18 \|\| ^19`     | UI components                                                                                                 |

### Optional peer dependencies

- `mermaid >= 11.0.0` — install if you want SVG rendering of `mermaid` artifacts. Without it, the renderer falls back to `<CodeBlock language="mermaid">`. **Important:** add `viteOptimizeDeps: ['mermaid']` to your `theo.config.ts` so Vite pre-bundles the dynamic import in dev mode.

## Quick start

### 1. Register the agent tool

```ts
// server/routes/chat.ts
import {
  defineAgentEndpoint,
  defineAgentTool,
  streamAgentRun,
  createConversationHistory,
} from 'theokit/server'
import { defineArtifactTool, createSqliteArtifactStore } from '@theokit/plugin-canvas'
import { createArtifactBus } from '@theokit/plugin-canvas/server'

// Module-scope singletons — see "Server-side artifact bus" below
const store = createSqliteArtifactStore({ db: yourSqliteDb })
const bus = createArtifactBus()

const publishArtifact = (convId: string) => {
  const cfg = defineArtifactTool({
    onPublish: async (artifact) => {
      const stored = await store.insert(artifact)
      bus.emit(convId, stored)
      return stored
    },
  })
  return defineAgentTool({
    name: cfg.name,
    description: cfg.description,
    inputSchema: cfg.inputSchema,
    handler: async (input) => JSON.stringify(await cfg.handler(input)),
  })
}

export const POST = defineAgentEndpoint({
  async *handler({ body, request, cookieHeaders, signal }) {
    const { message } = body as { message: string }
    const { agent, conversationId } = await createConversationHistory({
      request,
      response: { headers: cookieHeaders },
      options: { model: { id: 'openai/gpt-4o-mini' }, tools: [publishArtifact('')] },
    })

    // Subscribe BEFORE agent.send to avoid race
    const queue: AgentEvent[] = []
    const unsub = bus.subscribe(conversationId, (artifact) => {
      queue.push({ type: 'tool_result', name: 'publish_artifact', data: { artifact } })
    })

    const run = await agent.send(message, { signal })
    try {
      for await (const event of streamAgentRun(run)) {
        while (queue.length) yield queue.shift()!
        yield event
      }
    } finally {
      unsub()
    }
  },
})
```

### 2. Mount the panel

```tsx
// app/page.tsx
import { CanvasPanel, useCanvas, type Artifact } from '@theokit/plugin-canvas/ui'
import { useAgentStream } from 'theokit/client'
import { useEffect, useRef } from 'react'

export default function Page() {
  const { events } = useAgentStream<{ message: string }>('/api/chat')
  const canvas = useCanvas({ endpoint: '/api/canvas/artifacts' })

  const seen = useRef(0)
  useEffect(() => {
    for (let i = seen.current; i < events.length; i++) {
      const ev = events[i]
      if (ev?.type === 'tool_result' && ev.name === 'publish_artifact') {
        const artifact = (ev.data as { artifact?: Artifact })?.artifact
        if (artifact) canvas.show(artifact)
      }
    }
    seen.current = events.length
  }, [events, canvas])

  return (
    <>
      {/* … your chat UI … */}
      {canvas.open && (
        <div className="fixed inset-y-0 right-0 w-[40vw]">
          <CanvasPanel
            open={canvas.open}
            onOpenChange={canvas.setOpen}
            artifact={canvas.current}
            versions={canvas.versions}
            onVersionSelect={(a) => canvas.selectVersion(a.id, a.version)}
          />
        </div>
      )}
    </>
  )
}
```

## Server-side artifact bus

`createArtifactBus()` is a process-local pub/sub between the agent tool handler (which emits when `publish_artifact` is called) and the SSE endpoint (which subscribes to forward `tool_result` events to the browser).

```ts
import { createArtifactBus } from '@theokit/plugin-canvas/server'

const bus = createArtifactBus()
bus.subscribe('conversation-123', (artifact) => {
  /* … */
})
bus.emit('conversation-123', artifact)
```

### Warnings

- **Module-scope singleton.** `createArtifactBus()` creates in-memory state. Call it **once per process** (module top-level). Calling it inside factories or per-request creates isolated buses and emit/subscribe never meet.
- **Process-local.** Bus state lives in this process only. In **multi-instance deployments** (Vercel Functions, multi-pod K8s), subscribers in one pod do **not** see emits from another. A future `createRedisArtifactBus()` adapter will address this. Single-instance apps (Node server, single Docker, dev) work fine.
- **Handler isolation.** A handler that throws does **not** affect other handlers — `emit` wraps each handler call in `try/catch` and logs failures to `console.error`.

## Artifact kinds & security caps

| Kind               | Max bytes | Notes                                                                         |
| ------------------ | --------- | ----------------------------------------------------------------------------- |
| `markdown`         | 1 MB      | Caseiro parser (no GFM tables/strikethrough)                                  |
| `code`             | 1 MB      | Syntax highlight via `CodeBlock` (Shiki). `terminal: true` skips highlighting |
| `svg`              | 256 KB    | Schema + render-time sanitization (strip `<script>`)                          |
| `html`             | 256 KB    | `<iframe sandbox>` with closed enum: `'minimal' \| 'scripts' \| 'forms'`      |
| `mermaid`          | 64 KB     | Optional `mermaid` peer dep for SVG; falls back to `<CodeBlock>` if missing   |
| `diff`             | per hunk  | Renders via `DiffViewer` primitive                                            |
| `whiteboard-scene` | n/a       | Lazy-loads `@theokit/ui/whiteboard`                                           |
| `slide-deck`       | n/a       | Lazy-loads `@theokit/ui/slide-deck`                                           |
| `image`            | 5 MB      | `data:` URL with MIME prefix OR `https://` URL                                |

## License

MIT
