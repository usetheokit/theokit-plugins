/**
 * Heuristic extractor for "Open in Canvas" — turns a chat message
 * body into a list of `Artifact` candidates the user can promote.
 *
 * Detection (in priority order, first match wins for overlapping
 * spans):
 *
 *   - fenced code blocks  ```lang\n…\n```
 *     → `code` artifact with `language` from the fence info string
 *   - `lang === 'mermaid'` inside a fence → `mermaid` artifact
 *   - inline `<svg …>…</svg>` (loosely matched) → `svg` artifact
 *   - if nothing matches and the message is non-empty → ONE
 *     `markdown` artifact wrapping the whole body (so the button is
 *     always actionable instead of disappearing)
 *
 * The extractor does NOT publish — it returns descriptors. The
 * `<OpenInCanvasButton>` lets the user pick which descriptor to send,
 * then calls the consumer's `onPublish` callback with the matching
 * Artifact-shaped object (envelope filled in here).
 */

import type { Artifact } from '../schema.js'

const FENCE_RE = /(^|\n)```(\w[\w+-]*)?\n([\s\S]*?)\n```/g
const SVG_RE = /<svg\b[\s\S]*?<\/svg>/gi

export interface ExtractContext {
  /** Used to fabricate stable artifact ids from the source message. */
  messageId: string
  /** Used to populate `sessionId` on the artifact envelope. */
  sessionId?: string
}

/**
 * Something in a chat message that could become an artifact, before the user says so.
 *
 * `build` is a closure rather than a materialised artifact so a message with many code fences can be
 * enumerated for the picker without constructing an envelope for each one.
 */
export interface ArtifactCandidate {
  /** Stable per-message + per-snippet — usable as React key. */
  id: string
  /** Short label for the picker UI. */
  label: string
  /**
   * Closure that materialises the full `Artifact` when the user picks
   * this candidate. Defers envelope construction until publish-time so
   * the candidates can be enumerated without paying for it.
   */
  build: () => Artifact
}

/**
 * Find the publishable fragments in a chat message — fenced code, diagrams, diffs.
 *
 * Ids are derived from the message id and the snippet's position, so re-rendering the same message
 * yields the same candidate ids and React keys stay stable.
 */
export function extractArtifactCandidates(body: string, ctx: ExtractContext): ArtifactCandidate[] {
  const out: ArtifactCandidate[] = []
  const seenSpans: [number, number][] = []
  const now = new Date().toISOString()
  const base = (suffix: string) => ({
    id: `${ctx.messageId}-${suffix}`,
    sessionId: ctx.sessionId,
    version: 1,
    createdAt: now,
  })

  let fenceIndex = 0
  for (const match of body.matchAll(FENCE_RE)) {
    const lang = (match[2] ?? '').toLowerCase()
    const content = match[3] ?? ''
    const idx = match.index ?? 0
    seenSpans.push([idx, idx + match[0].length])
    const suffix = `fence-${fenceIndex++}`
    if (lang === 'mermaid') {
      out.push({
        id: `${ctx.messageId}-${suffix}`,
        label: `Mermaid diagram (${truncate(content, 24)})`,
        build: (): Artifact => ({
          ...base(suffix),
          title: title(`Diagram from ${ctx.messageId}`),
          kind: 'mermaid',
          content,
        }),
      })
      continue
    }
    out.push({
      id: `${ctx.messageId}-${suffix}`,
      label: `${lang.length > 0 ? lang : 'code'} block (${countLines(content)} lines)`,
      build: (): Artifact => ({
        ...base(suffix),
        title: title(`Code from ${ctx.messageId}`),
        kind: 'code',
        language: lang.length > 0 ? lang : 'text',
        content,
      }),
    })
  }

  let svgIndex = 0
  for (const match of body.matchAll(SVG_RE)) {
    const content = match[0]
    const idx = match.index ?? 0
    if (isInsideAnySpan(idx, seenSpans)) continue
    seenSpans.push([idx, idx + content.length])
    const suffix = `svg-${svgIndex++}`
    out.push({
      id: `${ctx.messageId}-${suffix}`,
      label: `Inline SVG`,
      build: (): Artifact => ({
        ...base(suffix),
        title: title(`SVG from ${ctx.messageId}`),
        kind: 'svg',
        content,
      }),
    })
  }

  if (out.length === 0 && body.trim().length > 0) {
    out.push({
      id: `${ctx.messageId}-md`,
      label: 'Whole message as markdown',
      build: (): Artifact => ({
        ...base('md'),
        title: title(`Message ${ctx.messageId}`),
        kind: 'markdown',
        content: body,
      }),
    })
  }

  return out
}

function isInsideAnySpan(index: number, spans: [number, number][]): boolean {
  for (const [a, b] of spans) {
    if (index >= a && index < b) return true
  }
  return false
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

function countLines(s: string): number {
  return s.split('\n').length
}

function title(s: string): string {
  return truncate(s, 60)
}
