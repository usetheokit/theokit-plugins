import { CodeBlock } from '@theokit/ui'
import { useEffect, useId, useRef, useState } from 'react'

import { sanitizeSvg } from './sanitize.js'
import type { ArtifactRendererProps } from './types.js'

interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, source: string): Promise<{ svg: string }>
}

let pending: Promise<MermaidApi | null> | null = null

function loadMermaid(): Promise<MermaidApi | null> {
  if (!pending) {
    pending = (async () => {
      // Optional peer dep. The specifier MUST be a string literal so Vite
      // can statically analyse the dynamic import and pre-bundle the dep
      // when the consumer installs it — `const s='mermaid'; import(s)`
      // works for tsup but Vite fails with "Failed to resolve module
      // specifier 'mermaid'" because dev-mode resolution requires a
      // literal it can trace. tsup keeps the import as `import('mermaid')`
      // because `mermaid` is listed in tsup external.
      // @ts-expect-error optional peer dep — types resolve only when the
      // consumer installs `mermaid`; absent it, we fall back gracefully.
      const mod = (await import('mermaid')) as unknown as { default: MermaidApi }
      const instance = mod.default
      instance.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
      return instance
    })().catch(() => {
      pending = null // clear on error so next caller retries
      return null
    })
  }
  return pending
}

/**
 * MermaidArtifact — renders a Mermaid diagram via the optional `mermaid`
 * peer dep. If the peer is missing OR the source fails to parse, the
 * renderer falls back to a styled `<pre>` block so the agent's output
 * is still visible.
 *
 * Mermaid runtime runs with `securityLevel: 'strict'` (Mermaid's
 * built-in sanitiser strips js/iframe). The agent's DSL is treated as
 * untrusted source — the renderer never injects it as HTML.
 */
export function MermaidArtifact({ artifact }: ArtifactRendererProps<'mermaid'>) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const mermaid = await loadMermaid()
      if (mermaid === null) {
        if (!cancelled) setFailed(true)
        return
      }
      try {
        const result = await mermaid.render(`mermaid-${id}`, artifact.content)
        // T1.3 (#177): defense-in-depth — sanitize the mermaid output before
        // injecting it. securityLevel:'strict' has documented XSS bypasses, so
        // we never trust the rendered SVG verbatim.
        if (!cancelled) setSvg(sanitizeSvg(result.svg).output)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [artifact.content, id])

  if (failed) {
    return (
      <div data-testid="mermaid-artifact" data-state="fallback" className="p-3">
        <CodeBlock code={artifact.content} language="mermaid" copyable />
      </div>
    )
  }

  return (
    <div
      data-testid="mermaid-artifact"
      data-state={svg !== null ? 'ready' : 'loading'}
      className="p-3"
    >
      <div
        ref={ref}
        className="grid place-items-center"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG is passed through sanitizeSvg (DOMPurify) before injection (T1.3/#177), on top of mermaid securityLevel=strict
        dangerouslySetInnerHTML={svg !== null ? { __html: svg } : undefined}
      />
    </div>
  )
}
