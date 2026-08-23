/**
 * Unit tests for the module-specifier extractor used by the packaging contract.
 *
 * The `node:`-prefix assertion used to find specifiers with a regex:
 *
 *     /(?:from|import)\s*\(?\s*["']([^"']+)["']/g
 *
 * `from` matches, `\(?` eats the opening paren, and the quoted argument is read as a module
 * specifier — so `Buffer.from('crypto')` reported the package as importing a Node builtin
 * without the `node:` prefix. That assertion runs on every pull request, so the first package
 * whose dist contained that expression would have reddened every PR with a fabricated
 * packaging BLOCKER (#84).
 */

import { describe, expect, it } from 'vitest'

import { moduleSpecifiers } from '../src/module-specifiers.js'

describe('moduleSpecifiers', () => {
  it('collects a static import', () => {
    expect(moduleSpecifiers(`import { x } from 'node:crypto'`)).toEqual(['node:crypto'])
  })

  it('collects a side-effect import with no bindings', () => {
    expect(moduleSpecifiers(`import 'node:process'`)).toEqual(['node:process'])
  })

  it('collects a re-export', () => {
    expect(moduleSpecifiers(`export { x } from './chunk-ABC.js'`)).toEqual(['./chunk-ABC.js'])
  })

  it('collects a star re-export', () => {
    expect(moduleSpecifiers(`export * from './provider.js'`)).toEqual(['./provider.js'])
  })

  it('collects a dynamic import', () => {
    expect(moduleSpecifiers(`const m = await import('node:fs/promises')`)).toEqual([
      'node:fs/promises',
    ])
  })

  it('does not read Buffer.from as an import', () => {
    // The defect, verbatim.
    expect(moduleSpecifiers(`const b = Buffer.from('crypto')`)).toEqual([])
  })

  it('does not read Array.from as an import', () => {
    expect(moduleSpecifiers(`const a = Array.from('os')`)).toEqual([])
  })

  it('ignores a specifier that only appears in a string literal', () => {
    expect(moduleSpecifiers(`const doc = "import x from 'crypto'"`)).toEqual([])
  })

  it('ignores a specifier that only appears in a comment', () => {
    expect(moduleSpecifiers(`// import x from 'crypto'\nexport const y = 1`)).toEqual([])
  })

  it('skips a dynamic import whose argument is not a literal', () => {
    // `import(name)` cannot be resolved without running the module. Reporting a guess would
    // put a specifier in the list that the file never imports.
    expect(moduleSpecifiers(`const m = await import(name)`)).toEqual([])
  })

  it('reports every specifier, including duplicates across forms', () => {
    const source = `import a from 'node:fs'\nexport { b } from 'node:fs'`
    expect(moduleSpecifiers(source)).toEqual(['node:fs', 'node:fs'])
  })
})
