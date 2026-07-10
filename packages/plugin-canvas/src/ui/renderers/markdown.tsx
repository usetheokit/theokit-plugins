/**
 * Minimal markdown → React tree converter.
 *
 * Why hand-rolled (not `react-markdown` / `marked` / `markdown-it`):
 *
 *   - artifacts are CHAT-shaped (short headers, paragraphs, code
 *     fences, lists, inline emphasis, links) — the long tail of
 *     markdown features (tables, definition lists, footnotes, html
 *     escape sequences, autolinks) is not worth the peer-dep weight
 *     for the MVP. Apps that need full GFM register their own
 *     `MarkdownArtifact` via the renderer registry (T4.3 ADR).
 *
 *   - links are sanitised inline: only `https://`, `http://` and `#`
 *     anchors are kept; `javascript:`, `data:` and unknown schemes
 *     fall back to a plain `<span>`.
 *
 *   - inline HTML is escaped — markdown source is treated as text,
 *     never inserted via `dangerouslySetInnerHTML`. Worst case a user
 *     sees raw `<` characters instead of a styled element.
 *
 * The converter returns a flat array of React nodes that the
 * `<MarkdownArtifact>` wraps in a `<div className="prose">` shell.
 */
import type { ReactNode } from 'react'

const SAFE_URL_RE = /^(https?:\/\/|\/|#|mailto:)/i

interface Inline {
  kind: 'text' | 'code' | 'bold' | 'italic' | 'link'
  value: string
  href?: string
}

function parseInline(line: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  while (i < line.length) {
    const tail = line.slice(i)
    let match: RegExpMatchArray | null
    match = tail.match(/^`([^`]+)`/)
    if (match) {
      out.push({ kind: 'code', value: match[1] ?? '' })
      i += match[0].length
      continue
    }
    match = tail.match(/^\*\*([^*]+)\*\*/)
    if (match) {
      out.push({ kind: 'bold', value: match[1] ?? '' })
      i += match[0].length
      continue
    }
    match = tail.match(/^\*([^*]+)\*/)
    if (match) {
      out.push({ kind: 'italic', value: match[1] ?? '' })
      i += match[0].length
      continue
    }
    match = tail.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (match) {
      const href = match[2] ?? ''
      if (SAFE_URL_RE.test(href)) {
        out.push({ kind: 'link', value: match[1] ?? '', href })
      } else {
        out.push({ kind: 'text', value: match[1] ?? '' })
      }
      i += match[0].length
      continue
    }
    out.push({ kind: 'text', value: line.charAt(i) })
    i += 1
  }
  return collapseText(out)
}

function collapseText(parts: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const p of parts) {
    const prev = out[out.length - 1]
    if (p.kind === 'text' && prev?.kind === 'text') {
      prev.value += p.value
    } else {
      out.push({ ...p })
    }
  }
  return out
}

function renderInline(parts: Inline[], keyPrefix: string): ReactNode[] {
  return parts.map((p, i): ReactNode => {
    const key = `${keyPrefix}-${i}`
    switch (p.kind) {
      case 'code':
        return (
          <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {p.value}
          </code>
        )
      case 'bold':
        return (
          <strong key={key} className="font-semibold">
            {p.value}
          </strong>
        )
      case 'italic':
        return (
          <em key={key} className="italic">
            {p.value}
          </em>
        )
      case 'link':
        return (
          <a
            key={key}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {p.value}
          </a>
        )
      default:
        return p.value
    }
  })
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    // fenced code
    if (/^```/.test(trimmed)) {
      const lang = trimmed.replace(/^```/, '').trim()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
        buf.push(lines[i] ?? '')
        i += 1
      }
      nodes.push(
        <pre
          key={`fence-${i}`}
          className="my-2 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs"
          data-language={lang || undefined}
        >
          <code>{buf.join('\n')}</code>
        </pre>,
      )
      i += 1 // skip closing fence
      continue
    }

    // heading
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1]?.length ?? 1
      const text = heading[2] ?? ''
      const inline = renderInline(parseInline(text), `h${level}-${i}`)
      const cls =
        level === 1
          ? 'mb-2 text-2xl font-semibold'
          : level === 2
            ? 'mt-3 mb-2 text-xl font-semibold'
            : 'mt-2 mb-1 text-base font-semibold'
      // `h${1..6}` is always a valid heading tag (level ≥ 1, capped at 6); the
      // template literal is never nullish, so no `?? 'h1'` fallback is needed.
      const Tag = `h${Math.min(level, 6)}` as 'h1'
      nodes.push(
        <Tag key={`h-${i}`} className={cls}>
          {inline}
        </Tag>,
      )
      i += 1
      continue
    }

    // list — gather contiguous bullets
    if (/^[-*]\s+/.test(trimmed)) {
      const items: ReactNode[] = []
      let j = i
      while (j < lines.length && /^[-*]\s+/.test((lines[j] ?? '').trim())) {
        const text = (lines[j] ?? '').trim().replace(/^[-*]\s+/, '')
        const inline = renderInline(parseInline(text), `li-${j}`)
        items.push(
          <li key={`li-${j}`} className="ml-5 list-disc">
            {inline}
          </li>,
        )
        j += 1
      }
      nodes.push(
        <ul key={`ul-${i}`} className="my-2 grid gap-1">
          {items}
        </ul>,
      )
      i = j
      continue
    }

    // blank line — paragraph break
    if (trimmed.length === 0) {
      i += 1
      continue
    }

    // paragraph
    const inline = renderInline(parseInline(line), `p-${i}`)
    nodes.push(
      <p key={`p-${i}`} className="my-1 leading-relaxed">
        {inline}
      </p>,
    )
    i += 1
  }
  return nodes
}
