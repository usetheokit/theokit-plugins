import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Manifest {
  peerDependencies: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest

// `@theokit/ui`'s Markdown imports these at runtime and lists them as optional peers itself,
// so the consumer only gets them if this package asks for them.
const MARKDOWN_RUNTIME = [
  'mdast-util-from-markdown',
  'mdast-util-gfm',
  'micromark-extension-gfm',
  'mdast-util-to-hast',
  'hast-util-sanitize',
  'hast-util-to-jsx-runtime',
]

describe('markdown renderer peers', () => {
  it.each(MARKDOWN_RUNTIME)('declares %s as a required peer', (name) => {
    expect(manifest.peerDependencies[name]).toBeDefined()
    expect(manifest.peerDependenciesMeta?.[name]?.optional).not.toBe(true)
  })
})
