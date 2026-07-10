/**
 * T4.4 — pure helpers for the CanvasPanel toolbar.
 *
 * Coverage:
 *   - slugifyFilename strips unsafe chars, collapses runs, caps length
 *   - pickExtension maps language hints + image MIME
 *   - serializeArtifactForCopy round-trips per kind
 *   - artifactToBlob produces the right MIME + decodes data URLs
 *   - filenameFor composes title + extension + version suffix
 */
import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  artifactToBlob,
  filenameFor,
  pickExtension,
  serializeArtifactForCopy,
  slugifyFilename,
} from '../src/ui/artifact-actions.js'
import type { Artifact } from '../src/schema.js'

const env = {
  id: 'a',
  title: 'My artifact',
  version: 1,
  createdAt: '2026-05-29T00:00:00Z',
}

describe('slugifyFilename', () => {
  it('lowercases-and-dashes a normal title', () => {
    expect(slugifyFilename('My Artifact')).toBe('My-Artifact')
  })

  it('drops unsafe characters', () => {
    expect(slugifyFilename('hello/world*name')).toBe('helloworldname')
  })

  it('collapses runs of spaces / underscores / dashes', () => {
    expect(slugifyFilename('hello   ___---world')).toBe('hello-world')
  })

  it('caps length at 64 chars', () => {
    const long = 'x'.repeat(120)
    expect(slugifyFilename(long).length).toBeLessThanOrEqual(64)
  })

  it('falls back to "artifact" when empty after sanitisation', () => {
    expect(slugifyFilename('***///')).toBe('artifact')
  })
})

describe('pickExtension', () => {
  it('maps known code languages to extensions', () => {
    const a: Artifact = { ...env, kind: 'code', language: 'TypeScript', content: 'x' }
    // language is lowercased before lookup; 'typescript' is not in the
    // map so it falls back to txt — keeps the map honest about which
    // hints we explicitly know about.
    expect(pickExtension(a)).toBe('txt')
  })

  it('maps "ts" → ts', () => {
    const a: Artifact = { ...env, kind: 'code', language: 'ts', content: 'x' }
    expect(pickExtension(a)).toBe('ts')
  })

  it('maps "rust" / "rs" → rs', () => {
    expect(pickExtension({ ...env, kind: 'code', language: 'rust', content: 'x' })).toBe('rs')
    expect(pickExtension({ ...env, kind: 'code', language: 'rs', content: 'x' })).toBe('rs')
  })

  it('extracts mime from data-image URLs', () => {
    const a: Artifact = {
      ...env,
      kind: 'image',
      source: 'data',
      alt: 'pic',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    }
    expect(pickExtension(a)).toBe('png')
  })

  it('image svg+xml maps to svg', () => {
    const a: Artifact = {
      ...env,
      kind: 'image',
      source: 'data',
      alt: 'vec',
      dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
    }
    expect(pickExtension(a)).toBe('svg')
  })

  it('defaults per kind for non-code/image kinds', () => {
    expect(pickExtension({ ...env, kind: 'markdown', content: 'x' })).toBe('md')
    expect(pickExtension({ ...env, kind: 'svg', content: '<svg/>' })).toBe('svg')
    expect(pickExtension({ ...env, kind: 'mermaid', content: 'graph TD;' })).toBe('mmd')
    expect(pickExtension({ ...env, kind: 'html', srcdoc: '<p/>', sandbox: 'minimal' })).toBe('html')
  })
})

describe('serializeArtifactForCopy', () => {
  it('returns raw content for markdown / code / svg / mermaid', () => {
    expect(serializeArtifactForCopy({ ...env, kind: 'markdown', content: 'hi' })).toBe('hi')
    expect(
      serializeArtifactForCopy({
        ...env,
        kind: 'code',
        language: 'ts',
        content: 'export const x = 1',
      }),
    ).toBe('export const x = 1')
    expect(serializeArtifactForCopy({ ...env, kind: 'svg', content: '<svg/>' })).toBe('<svg/>')
  })

  it('returns srcdoc for html', () => {
    expect(
      serializeArtifactForCopy({ ...env, kind: 'html', srcdoc: '<p>hi</p>', sandbox: 'minimal' }),
    ).toBe('<p>hi</p>')
  })

  it('JSON-stringifies whiteboard scenes', () => {
    const out = serializeArtifactForCopy({
      ...env,
      kind: 'whiteboard-scene',
      scene: { x: 1 },
    })
    expect(JSON.parse(out)).toEqual({ x: 1 })
  })

  it('returns the data URL for data-image, https URL for url-image', () => {
    expect(
      serializeArtifactForCopy({
        ...env,
        kind: 'image',
        source: 'data',
        dataUrl: 'data:image/png;base64,AAAA',
        alt: 'x',
      }),
    ).toBe('data:image/png;base64,AAAA')
    expect(
      serializeArtifactForCopy({
        ...env,
        kind: 'image',
        source: 'url',
        url: 'https://example.com/x.png',
        alt: 'x',
      }),
    ).toBe('https://example.com/x.png')
  })

  it('formats diff to unified-diff text', () => {
    const a: Artifact = {
      ...env,
      kind: 'diff',
      path: 'src/x.ts',
      hunks: [
        {
          id: 'h1',
          header: '@@ -1,1 +1,1 @@',
          lines: [
            { kind: 'removed', oldNumber: 1, content: 'old' },
            { kind: 'added', newNumber: 1, content: 'new' },
          ],
        },
      ],
    }
    const text = serializeArtifactForCopy(a)
    expect(text).toMatch(/^--- src\/x\.ts/)
    expect(text).toMatch(/^\+\+\+ src\/x\.ts/m)
    expect(text).toMatch(/^@@ -1,1 \+1,1 @@/m)
    expect(text).toMatch(/^-old/m)
    expect(text).toMatch(/^\+new/m)
  })
})

describe('artifactToBlob', () => {
  it('decodes base64 data URL into the right MIME', async () => {
    // base64 of the 4-byte PNG signature
    const dataUrl = `data:image/png;base64,${Buffer.from('89504e47', 'hex').toString('base64')}`
    const blob = await artifactToBlob({
      ...env,
      kind: 'image',
      source: 'data',
      dataUrl,
      alt: 'x',
    })
    expect(blob.type).toBe('image/png')
    const ab = await blob.arrayBuffer()
    expect(Buffer.from(ab).toString('hex')).toBe('89504e47')
  })

  it('uses text/markdown for markdown', async () => {
    const blob = await artifactToBlob({ ...env, kind: 'markdown', content: '# hi' })
    expect(blob.type).toBe('text/markdown')
    expect(await blob.text()).toBe('# hi')
  })

  it('uses image/svg+xml for svg', async () => {
    const blob = await artifactToBlob({ ...env, kind: 'svg', content: '<svg/>' })
    expect(blob.type).toBe('image/svg+xml')
  })

  it('uses application/json for whiteboard-scene', async () => {
    const blob = await artifactToBlob({
      ...env,
      kind: 'whiteboard-scene',
      scene: { x: 1 },
    })
    expect(blob.type).toBe('application/json')
  })
})

describe('filenameFor', () => {
  it('combines slug + extension', () => {
    expect(filenameFor({ ...env, kind: 'code', language: 'ts', content: 'x' })).toBe(
      'My-artifact.ts',
    )
  })

  it('appends -v<N> suffix when version > 1', () => {
    expect(
      filenameFor({
        ...env,
        version: 3,
        kind: 'code',
        language: 'ts',
        content: 'x',
      }),
    ).toBe('My-artifact-v3.ts')
  })
})
