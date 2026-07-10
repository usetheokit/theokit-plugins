/**
 * @vitest-environment jsdom
 *
 * T4.3 — Dispatcher + renderer registry tests. The two engine kinds
 * (`whiteboard-scene`, `slide-deck`) lazy-load their @theokit/ui
 * subpaths; jsdom does not resolve those installs so the Suspense
 * fallback is asserted instead of the rendered engine — that's the
 * documented behaviour outside a real browser.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ArtifactRenderer } from '../src/ui/artifact-renderer.js'
import type { Artifact } from '../src/schema.js'

const env = {
  id: 'art-1',
  title: 'My artifact',
  version: 1,
  createdAt: '2026-05-29T00:00:00Z',
}

describe('ArtifactRenderer — dispatch by kind', () => {
  it('renders markdown artifact via MarkdownArtifact', () => {
    const a: Artifact = { ...env, kind: 'markdown', content: '# Heading\n\nText' }
    render(<ArtifactRenderer artifact={a} />)
    expect(screen.getByTestId('markdown-artifact')).toBeInTheDocument()
    expect(screen.getByText('Heading')).toBeInTheDocument()
  })

  it('renders code artifact with language and content (delegates to CodeBlock)', () => {
    const a: Artifact = { ...env, kind: 'code', language: 'ts', content: 'export const x = 1' }
    render(<ArtifactRenderer artifact={a} />)
    const el = screen.getByTestId('code-artifact')
    expect(el).toBeInTheDocument()
    // data-language moved to wrapper after T2.1 CodeBlock refactor
    expect(el.getAttribute('data-language')).toBe('ts')
    expect(el).toHaveTextContent('export const x = 1')
  })

  it('renders diff artifact with hunks + stats via DiffViewer (T2.2)', () => {
    const a: Artifact = {
      ...env,
      kind: 'diff',
      path: 'src/x.ts',
      stats: { added: 1, removed: 1 },
      hunks: [
        {
          id: 'h1',
          lines: [
            { kind: 'removed', oldNumber: 1, content: 'old line' },
            { kind: 'added', newNumber: 1, content: 'new line' },
          ],
        },
      ],
    }
    render(<ArtifactRenderer artifact={a} />)
    expect(screen.getByTestId('diff-artifact')).toBeInTheDocument()
    expect(screen.getByText(/src\/x\.ts/)).toBeInTheDocument()
    // EC-7: assert content (not testid which is DiffViewer-internal)
    expect(screen.getByText('old line')).toBeInTheDocument()
    expect(screen.getByText('new line')).toBeInTheDocument()
  })

  it('renders svg artifact (sanitised pass-through)', () => {
    const a: Artifact = {
      ...env,
      kind: 'svg',
      content: '<svg><rect width="10" height="10"/></svg>',
    }
    render(<ArtifactRenderer artifact={a} />)
    const el = screen.getByTestId('svg-artifact')
    expect(el).toBeInTheDocument()
    expect(el.innerHTML).toMatch(/<rect/i)
  })

  it('svg renderer reports strip via data attributes', () => {
    const a: Artifact = {
      ...env,
      kind: 'svg',
      // boundary schema accepts content starting with <svg>; the renderer
      // sanitises again so a tampered-with svg cannot bypass.
      content: '<svg><script>bad()</script><rect/></svg>',
    }
    render(<ArtifactRenderer artifact={a} />)
    const el = screen.getByTestId('svg-artifact')
    expect(el.getAttribute('data-strip-script')).toBe('true')
  })

  it('renders html artifact as sandboxed iframe with sandbox attr', () => {
    const a: Artifact = {
      ...env,
      kind: 'html',
      srcdoc: '<p>hi</p>',
      sandbox: 'minimal',
    }
    render(<ArtifactRenderer artifact={a} />)
    const wrapper = screen.getByTestId('html-artifact')
    const iframe = wrapper.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.getAttribute('data-sandbox')).toBe('minimal')
  })

  it('html sandbox=scripts maps to allow-scripts', () => {
    const a: Artifact = {
      ...env,
      kind: 'html',
      srcdoc: '<p>hi</p>',
      sandbox: 'scripts',
    }
    render(<ArtifactRenderer artifact={a} />)
    const iframe = screen.getByTestId('html-artifact').querySelector('iframe') as HTMLIFrameElement
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('html sandbox=forms maps to allow-scripts allow-forms (never same-origin)', () => {
    const a: Artifact = {
      ...env,
      kind: 'html',
      srcdoc: '<form></form>',
      sandbox: 'forms',
    }
    render(<ArtifactRenderer artifact={a} />)
    const iframe = screen.getByTestId('html-artifact').querySelector('iframe') as HTMLIFrameElement
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    expect(iframe.getAttribute('sandbox')).not.toMatch(/same-origin/)
  })

  it('renders data-image artifact with alt + lazy loading', () => {
    const a: Artifact = {
      ...env,
      kind: 'image',
      source: 'data',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      alt: 'Login page',
    }
    render(<ArtifactRenderer artifact={a} />)
    const img = screen.getByTestId('image-artifact').querySelector('img') as HTMLImageElement
    expect(img.getAttribute('alt')).toBe('Login page')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('data-source')).toBe('data')
  })

  it('renders url-image artifact', () => {
    const a: Artifact = {
      ...env,
      kind: 'image',
      source: 'url',
      url: 'https://example.com/x.png',
      alt: 'pic',
    }
    render(<ArtifactRenderer artifact={a} />)
    const img = screen.getByTestId('image-artifact').querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://example.com/x.png')
    expect(img.getAttribute('data-source')).toBe('url')
  })

  it('whiteboard-scene shows Suspense fallback when @theokit/ui not installed', () => {
    const a: Artifact = {
      ...env,
      kind: 'whiteboard-scene',
      scene: { elements: [] },
    }
    render(<ArtifactRenderer artifact={a} />)
    const wrap = screen.getByTestId('whiteboard-artifact')
    expect(wrap).toBeInTheDocument()
    expect(wrap.textContent ?? '').toMatch(/Loading whiteboard/i)
  })

  it('slide-deck shows Suspense fallback when @theokit/ui not installed', () => {
    const a: Artifact = {
      ...env,
      kind: 'slide-deck',
      source: '# Title',
    }
    render(<ArtifactRenderer artifact={a} />)
    const wrap = screen.getByTestId('slide-deck-artifact')
    expect(wrap.textContent ?? '').toMatch(/Loading slide/i)
  })

  it('mermaid shows loading state initially', () => {
    const a: Artifact = { ...env, kind: 'mermaid', content: 'graph TD; A-->B' }
    render(<ArtifactRenderer artifact={a} />)
    const el = screen.getByTestId('mermaid-artifact')
    // jsdom will fail the mermaid import → falls back. We assert one
    // of the two terminal states is present after first paint.
    expect(['loading', 'fallback', 'ready']).toContain(el.getAttribute('data-state'))
  })
})

describe('ArtifactRenderer — registry override', () => {
  it('apps can override a kind via renderers prop', () => {
    const a: Artifact = { ...env, kind: 'markdown', content: '# original' }
    const Custom = () => <div data-testid="custom-md">CUSTOM MARKDOWN</div>
    render(<ArtifactRenderer artifact={a} renderers={{ markdown: Custom }} />)
    expect(screen.getByTestId('custom-md')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-artifact')).toBeNull()
  })

  it('partial override preserves other kinds', () => {
    const a: Artifact = { ...env, kind: 'code', language: 'ts', content: 'x' }
    const Custom = () => <div data-testid="custom-md">CUSTOM</div>
    render(<ArtifactRenderer artifact={a} renderers={{ markdown: Custom }} />)
    // code artifact still uses default
    expect(screen.getByTestId('code-artifact')).toBeInTheDocument()
  })
})

describe('ArtifactRenderer — root attrs', () => {
  it('emits data-kind / data-version / data-artifact-id on the root', () => {
    const a: Artifact = { ...env, id: 'art-42', version: 3, kind: 'markdown', content: 'hi' }
    render(<ArtifactRenderer artifact={a} />)
    const root = screen.getByTestId('artifact-renderer')
    expect(root.getAttribute('data-kind')).toBe('markdown')
    expect(root.getAttribute('data-version')).toBe('3')
    expect(root.getAttribute('data-artifact-id')).toBe('art-42')
  })
})
