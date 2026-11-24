# `@theokit/plugin-canvas`

Canvas plugin for TheoKit — agent artifact protocol + side panel UI + agent custom tool.

Render 12 artifact kinds (markdown, code, svg, diff, whiteboard-scene, slide-deck, mermaid, html, image, list, table, metric) inside an auto-opening side panel. Agents publish via the `publish_artifact` tool; the panel reacts in real time via SSE.

## Installation

```bash
pnpm add @theokit/plugin-canvas @usetheo/ui @theokit/ui
```

### Required peer dependencies

| Package                                                                                                                                         | Version            | Why                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `@usetheo/ui`                                                                                                                                   | `>= 0.14.0`        | Generic UI primitives (`Button`, `Card`, `CopyButton`, `Tooltip`, `DropdownMenu`, `Alert`, `CodeBlock`, etc.) |
| `@theokit/ui`                                                                                                                                   | `^1.15.0`          | AI surfaces + engines (`DiffViewer`, `@theokit/ui/whiteboard`, `@theokit/ui/slide-deck`)                      |
| `mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm`, `mdast-util-to-hast`, `hast-util-sanitize`, `hast-util-to-jsx-runtime` | see `package.json` | Needed by the `Markdown` component of `@theokit/ui`, which renders markdown artifacts                         |
| `@theokit/sdk`                                                                                                                                  | `>= 1.0.0`         | Agent tool runtime / schema validation                                                                        |
| `theokit`                                                                                                                                       | `>= 0.1.0-alpha.5` | `defineAgentTool`, `defineAgentEndpoint`, route handlers                                                      |
| `react`                                                                                                                                         | `^18 \|\| ^19`     | UI components                                                                                                 |

### Optional peer dependencies

- `mermaid >= 11.0.0` — install if you want SVG rendering of `mermaid` artifacts. Without it, the renderer falls back to `<CodeBlock language="mermaid">`. **Important:** add `viteOptimizeDeps: ['mermaid']` to your `theo.config.ts` so Vite pre-bundles the dynamic import in dev mode.

## Quick start

### 1. Publish artifacts from an agent tool

<!-- doc-example: partial -->

```ts
// agents/chat.ts — the tool your agent calls to put something on the canvas
import { defineArtifactTool, createSqliteArtifactStore } from '@theokit/plugin-canvas'
import { createArtifactBus } from '@theokit/plugin-canvas/server'
import { tool } from 'theokit/server'

// Module-scope singletons — see "Server-side artifact bus" below
const store = createSqliteArtifactStore({ db: yourSqliteDb })
const bus = createArtifactBus()

export const publishArtifact = (conversationId: string) => {
  const cfg = defineArtifactTool({
    onPublish: async (artifact) => {
      const stored = await store.insert(artifact)
      bus.emit(conversationId, stored)
      return stored
    },
  })
  return tool(cfg.name)
    .describe(cfg.description)
    .input(cfg.inputSchema)
    .execute(async (input) => JSON.stringify(await cfg.handler(input)))
    .build()
}
```

`defineArtifactTool` gives you the validated name, description, schema and handler;
`tool()` is TheoKit's builder that turns them into something an agent can call. The
validation runs before `onPublish`, so a model that invents an artifact shape gets a
tool error it can recover from instead of writing a malformed row.

TheoKit serves the agent itself — an agent under `agentsDir` (default `agents/`) is
discovered and exposed at `/api/agents/<name>`, which is what the panel binds to below.
This package does not mount a route: a plugin cannot register one.

### 2. Mount the panel

```tsx
// app/page.tsx
import { CanvasPanel, useCanvas, type Artifact } from '@theokit/plugin-canvas/ui'
import { useEffect } from 'react'
import { useAgent } from 'theokit/client'

export default function Page() {
  const agent = useAgent<{ message: string }>('/api/agents/chat')
  const canvas = useCanvas({ endpoint: '/api/canvas/artifacts' })

  // Artifacts arrive on the SSE stream your app feeds from `bus.subscribe` — see
  // "Server-side artifact bus" below. The panel does not poll and does not read the
  // agent stream; it shows whatever you hand `canvas.show`.
  useEffect(() => {
    const source = new EventSource('/api/canvas/stream')
    source.onmessage = (event) => canvas.show(JSON.parse(event.data) as Artifact)
    return () => source.close()
  }, [canvas])

  return (
    <>
      {/* … your chat UI, driven by agent.thread / agent.send … */}
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

<!-- doc-example: partial -->

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

### Structured data kinds: `list`, `table`, `metric`

For lists, small tables and a single number with a label. Every string is plain text: renderers print it as a text node, never as HTML or markdown, so these kinds need no security pass. Like every artifact they also carry the envelope fields (`id`, `title`, and so on).

| Kind     | Field               | Rule                                                                    |
| -------- | ------------------- | ----------------------------------------------------------------------- |
| `list`   | `items: string[]`   | 1 to 200 items, each at most 500 characters                             |
| `list`   | `ordered?: boolean` | `true` renders an `<ol>`, otherwise a `<ul>`                            |
| `table`  | `columns: string[]` | 1 to 20 headers, each at most 500 characters                            |
| `table`  | `rows: string[][]`  | At most 200 rows, each cell at most 500 characters, one cell per column |
| `metric` | `label`, `value`    | Each at most 500 characters                                             |
| `metric` | `unit?`, `delta?`   | Each at most 32 characters, for example `'%'` and `'+4%'`               |

A table row with more or fewer cells than `columns` is rejected by `validateArtifact` and `isArtifact` with the message `every table row needs one cell per column`.

<!-- doc-example: partial -->

```ts
const artifact = {
  id: 'sales-q3',
  title: 'Sales by region',
  kind: 'table',
  columns: ['Region', 'Revenue'],
  rows: [
    ['EMEA', '1.2M'],
    ['APAC', '0.9M'],
  ],
}
```

## License

MIT
