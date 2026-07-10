/**
 * T4.2 — Zod schema tests.
 *
 * Cover happy-path for each of the 9 kinds, oversize regressions per
 * kind, security checks for svg + html + image, and the helper APIs
 * (validateArtifact, isArtifact, enforceArtifactSecurity).
 */
import { describe, expect, it } from 'vitest'

import {
  ARTIFACT_KINDS,
  CanvasArtifactSecurityError,
  CanvasArtifactValidationError,
  enforceArtifactSecurity,
  isArtifact,
  validateArtifact,
  type Artifact,
} from '../src/index.js'

const env = (extras: Partial<{ id: string; title: string; sessionId: string }> = {}) => ({
  id: extras.id ?? 'art-1',
  title: extras.title ?? 'Hello',
  ...(extras.sessionId !== undefined ? { sessionId: extras.sessionId } : {}),
})

describe('ARTIFACT_KINDS', () => {
  it('lists all 9 v0.1.0 kinds in stable order', () => {
    expect(ARTIFACT_KINDS).toEqual([
      'markdown',
      'code',
      'diff',
      'svg',
      'whiteboard-scene',
      'slide-deck',
      'mermaid',
      'html',
      'image',
    ])
  })
})

describe('validateArtifact — happy paths', () => {
  it('accepts a markdown artifact', () => {
    const result = validateArtifact({ kind: 'markdown', content: '# hi', ...env() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.artifact.kind).toBe('markdown')
      expect(result.artifact.version).toBe(1)
      expect(result.artifact.createdAt).toBeDefined()
    }
  })

  it('accepts a code artifact with language + terminal flag', () => {
    const result = validateArtifact({
      kind: 'code',
      language: 'ts',
      content: 'export const x = 1',
      terminal: false,
      ...env(),
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a diff artifact with hunks', () => {
    const result = validateArtifact({
      kind: 'diff',
      path: 'src/app.ts',
      stats: { added: 2, removed: 1 },
      hunks: [
        {
          id: 'h1',
          lines: [
            { kind: 'added', newNumber: 1, content: 'export const x = 1' },
            { kind: 'unchanged', oldNumber: 1, newNumber: 2, content: '' },
          ],
        },
      ],
      ...env(),
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a svg artifact starting with <svg>', () => {
    const result = validateArtifact({
      kind: 'svg',
      content: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
      ...env(),
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a whiteboard-scene artifact', () => {
    const result = validateArtifact({
      kind: 'whiteboard-scene',
      scene: { elements: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100 }] },
      ...env(),
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a slide-deck artifact with markdown source', () => {
    const result = validateArtifact({
      kind: 'slide-deck',
      source: '# Title\n---\n# Slide 2',
      ...env(),
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a mermaid artifact', () => {
    const result = validateArtifact({
      kind: 'mermaid',
      content: 'graph TD; A-->B',
      ...env(),
    })
    expect(result.ok).toBe(true)
  })

  it('accepts an html artifact with default sandbox=minimal', () => {
    const result = validateArtifact({
      kind: 'html',
      srcdoc: '<!doctype html><p>hi</p>',
      ...env(),
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.artifact.kind === 'html') {
      expect(result.artifact.sandbox).toBe('minimal')
    }
  })

  it('accepts a data-image artifact with alt + sized base64', () => {
    const result = validateArtifact({
      kind: 'image',
      source: 'data',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAA=',
      alt: 'Login screenshot',
      ...env(),
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a url-image artifact with https only', () => {
    const result = validateArtifact({
      kind: 'image',
      source: 'url',
      url: 'https://example.com/login.png',
      alt: 'Login screenshot',
      ...env(),
    })
    expect(result.ok).toBe(true)
  })
})

describe('validateArtifact — boundary regressions', () => {
  it('rejects code content > 1 MB', () => {
    const result = validateArtifact({
      kind: 'code',
      language: 'js',
      content: 'x'.repeat(1_048_577),
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects svg content > 256 KB', () => {
    const result = validateArtifact({
      kind: 'svg',
      content: `<svg>${'x'.repeat(262_145)}</svg>`,
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects html srcdoc > 256 KB', () => {
    const result = validateArtifact({
      kind: 'html',
      srcdoc: 'x'.repeat(262_145),
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects data image > 5 MB', () => {
    const result = validateArtifact({
      kind: 'image',
      source: 'data',
      dataUrl: `data:image/png;base64,${'A'.repeat(5_242_880)}`,
      alt: 'big',
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  /**
   * Regression: the size cap MUST NOT depend on Node's `Buffer`. The
   * plugin ships in the browser bundle via `@theokit/plugin-canvas/ui`
   * and shares the schema; a previous build referenced
   * `Buffer.byteLength` and crashed the browser with
   * `ReferenceError: Buffer is not defined`. The fix uses TextEncoder
   * (a Web Standard available in every modern runtime). This test
   * proves the path by deleting the global Buffer for the duration of
   * the call — if validation still works, TextEncoder is owning the
   * byte count.
   */
  it('counts bytes without relying on Node Buffer (browser-safe)', () => {
    const globalWithBuffer = globalThis as { Buffer?: unknown }
    const originalBuffer = globalWithBuffer.Buffer
    delete globalWithBuffer.Buffer
    try {
      const ok = validateArtifact({
        kind: 'code',
        language: 'ts',
        content: 'export const ok = true',
        ...env(),
      })
      expect(ok.ok).toBe(true)
      // Multi-byte chars must still count correctly — 1 emoji = 4 bytes
      // in UTF-8, so a cap-1 byte content of "💥" repeated should still
      // be accepted under the 1 MB cap.
      const multibyte = validateArtifact({
        kind: 'markdown',
        content: '💥'.repeat(1000), // ~4 KB
        ...env(),
      })
      expect(multibyte.ok).toBe(true)
    } finally {
      if (originalBuffer !== undefined) {
        ;(globalThis as { Buffer?: unknown }).Buffer = originalBuffer
      }
    }
  })
})

describe('validateArtifact — security defaults at the boundary', () => {
  it('rejects svg without leading <svg> tag', () => {
    const result = validateArtifact({
      kind: 'svg',
      content: '<html>not actually svg</html>',
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects image with http:// URL (not https)', () => {
    const result = validateArtifact({
      kind: 'image',
      source: 'url',
      url: 'http://example.com/x.png',
      alt: 'x',
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects image with data: URL via the URL variant', () => {
    const result = validateArtifact({
      kind: 'image',
      source: 'url',
      url: 'data:image/png;base64,iVBORw0KGgo',
      alt: 'x',
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects image with javascript: URL', () => {
    const result = validateArtifact({
      kind: 'image',
      source: 'url',
      url: 'javascript:alert(1)',
      alt: 'x',
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects data image with non-image MIME prefix', () => {
    const result = validateArtifact({
      kind: 'image',
      source: 'data',
      dataUrl: 'data:application/javascript;base64,YWxlcnQoMSk=',
      alt: 'x',
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects html sandbox value outside the closed enum', () => {
    const result = validateArtifact({
      kind: 'html',
      srcdoc: '<p>hi</p>',
      sandbox: 'allow-top-navigation' as 'minimal',
      ...env(),
    })
    expect(result.ok).toBe(false)
  })
})

describe('validateArtifact — invalid envelope', () => {
  it('rejects missing id', () => {
    const result = validateArtifact({ kind: 'markdown', content: 'x', title: 'x' })
    expect(result.ok).toBe(false)
  })

  it('rejects empty title', () => {
    const result = validateArtifact({ kind: 'markdown', content: 'x', id: 'a', title: '' })
    expect(result.ok).toBe(false)
  })

  it('rejects version <= 0', () => {
    const result = validateArtifact({
      kind: 'markdown',
      content: 'x',
      version: 0,
      ...env(),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown kind', () => {
    const result = validateArtifact({ kind: 'audio', content: 'x', ...env() })
    expect(result.ok).toBe(false)
  })

  it('error.issues lists at least one path/message', () => {
    const result = validateArtifact({ kind: 'markdown', content: 'x', id: 'a', title: '' })
    if (result.ok) throw new Error('expected failure')
    expect(result.error.issues.length).toBeGreaterThan(0)
    expect(result.error.issues[0]?.path).toBeDefined()
  })

  it('throwOnError=true throws CanvasArtifactValidationError', () => {
    expect(() =>
      validateArtifact(
        { kind: 'markdown', content: 'x', id: 'a', title: '' },
        { throwOnError: true },
      ),
    ).toThrowError(CanvasArtifactValidationError)
  })
})

describe('isArtifact', () => {
  it('returns true for a valid artifact (type narrowed)', () => {
    const input: unknown = { kind: 'markdown', content: 'x', ...env() }
    expect(isArtifact(input)).toBe(true)
    if (isArtifact(input)) {
      const a: Artifact = input
      expect(a.kind).toBe('markdown')
    }
  })

  it('returns false for non-objects', () => {
    expect(isArtifact(null)).toBe(false)
    expect(isArtifact(undefined)).toBe(false)
    expect(isArtifact('')).toBe(false)
    expect(isArtifact(0)).toBe(false)
  })
})

describe('enforceArtifactSecurity', () => {
  it('throws on svg with <script> tag', () => {
    const artifact: Artifact = {
      kind: 'svg',
      content: '<svg><script>alert(1)</script></svg>',
      id: 'a',
      title: 't',
      version: 1,
      createdAt: '2026-05-29T00:00:00Z',
    }
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(CanvasArtifactSecurityError)
  })

  it('throws on svg with xlink:href=javascript:', () => {
    const artifact: Artifact = {
      kind: 'svg',
      content: `<svg><a xlink:href="javascript:alert(1)">hi</a></svg>`,
      id: 'a',
      title: 't',
      version: 1,
      createdAt: '2026-05-29T00:00:00Z',
    }
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(/javascript/)
  })

  it('throws on html srcdoc with meta refresh', () => {
    const artifact: Artifact = {
      kind: 'html',
      srcdoc: '<meta http-equiv="refresh" content="0;url=https://evil">',
      sandbox: 'minimal',
      id: 'a',
      title: 't',
      version: 1,
      createdAt: '2026-05-29T00:00:00Z',
    }
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(/meta refresh/)
  })

  it('is a no-op for clean artifacts', () => {
    const artifact: Artifact = {
      kind: 'markdown',
      content: '# safe',
      id: 'a',
      title: 't',
      version: 1,
      createdAt: '2026-05-29T00:00:00Z',
    }
    expect(() => enforceArtifactSecurity(artifact)).not.toThrow()
  })

  // T1.2 (#178) — coverage extended to image(svg+xml data url), mermaid, slide-deck.
  const baseEnv = { id: 'a', title: 't', version: 1, createdAt: '2026-05-29T00:00:00Z' }

  it('throws on image data:image/svg+xml carrying <script>', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    const artifact = {
      kind: 'image',
      source: 'data',
      alt: 'x',
      dataUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(CanvasArtifactSecurityError)
  })

  it('throws CanvasArtifactSecurityError (not a raw decode error) on malformed svg+xml base64 (EC-6)', () => {
    const artifact = {
      kind: 'image',
      source: 'data',
      alt: 'x',
      dataUrl: 'data:image/svg+xml;base64,@@@not-base64@@@',
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(CanvasArtifactSecurityError)
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(/malformed|base64/i)
  })

  it('does NOT throw on a clean image data:image/svg+xml', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
    const artifact = {
      kind: 'image',
      source: 'data',
      alt: 'x',
      dataUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).not.toThrow()
  })

  it('does NOT decode/sanitize raster image data urls (png passes through)', () => {
    const artifact = {
      kind: 'image',
      source: 'data',
      alt: 'x',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).not.toThrow()
  })

  it('throws on mermaid source with a click-call callback vector', () => {
    const artifact = {
      kind: 'mermaid',
      content: 'graph TD\n  A-->B\n  click A call evilHandler()',
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(/mermaid/i)
  })

  it('throws on mermaid source with embedded <script>', () => {
    const artifact = {
      kind: 'mermaid',
      content: 'graph TD\n  A["<script>alert(1)</script>"]-->B',
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(CanvasArtifactSecurityError)
  })

  it('does NOT throw on a benign mermaid diagram', () => {
    const artifact = {
      kind: 'mermaid',
      content: 'graph TD\n  A-->B\n  B-->C',
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).not.toThrow()
  })

  it('throws on slide-deck markdown source carrying <script>', () => {
    const artifact = {
      kind: 'slide-deck',
      source: '# Slide\n\n<script>alert(1)</script>',
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).toThrowError(CanvasArtifactSecurityError)
  })

  it('does NOT throw on a benign slide-deck markdown source', () => {
    const artifact = {
      kind: 'slide-deck',
      source: '# Slide 1\n\nHello.\n\n---\n\n# Slide 2',
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).not.toThrow()
  })

  it('does NOT throw on a slide-deck with a pre-parsed array source (sanitized downstream)', () => {
    const artifact = {
      kind: 'slide-deck',
      source: [{ title: 'a' }, { title: 'b' }],
      ...baseEnv,
    } as Artifact
    expect(() => enforceArtifactSecurity(artifact)).not.toThrow()
  })
})
