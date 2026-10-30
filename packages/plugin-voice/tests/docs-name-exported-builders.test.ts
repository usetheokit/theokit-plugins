/**
 * The README and the published docblocks name route builders theokit actually exports.
 *
 * The README told readers to wire each endpoint "via `defineRoute`", and four docblocks in `src`
 * (which ship in the `.d.ts` files) said the same. theokit exports no `defineRoute` from any
 * subpath; the builder is `route()` from `theokit/server/define`. `pnpm quality:doc-api` compiles
 * documented imports, so a name that only appears in prose or a comment slips past it. This test
 * checks the prose against the module itself.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as define from 'theokit/server/define'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIR = join(import.meta.dirname, '..')
const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8')

/** Every `/** ... *\/` block under `src`, which is what reaches consumers through the `.d.ts`. */
function docblocks(dir: string): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...docblocks(path))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    for (const block of readFileSync(path, 'utf8').match(/\/\*\*[\s\S]*?\*\//g) ?? []) {
      found.push({ file: path, text: block })
    }
  }
  return found
}

/** `define*` builder names written as inline code, e.g. `defineRoute` or `defineRoute(...)`. */
function builderNames(text: string): string[] {
  return [...text.matchAll(/`(define[A-Z]\w*)/g)].map((match) => match[1] as string)
}

describe('plugin-voice docs against theokit/server/define', () => {
  const exported = new Set(Object.keys(define))

  it('README names only define* builders theokit exports', () => {
    expect(builderNames(readme).filter((name) => !exported.has(name))).toEqual([])
  })

  it('published docblocks name only define* builders theokit exports', () => {
    const missing = docblocks(join(PACKAGE_DIR, 'src')).flatMap(({ file, text }) =>
      builderNames(text)
        .filter((name) => !exported.has(name))
        .map((name) => `${file.slice(PACKAGE_DIR.length + 1)}: ${name}`),
    )
    expect(missing).toEqual([])
  })

  it('README tells readers to wire endpoints with route() from theokit/server/define', () => {
    expect(exported.has('route')).toBe(true)
    expect(readme).toMatch(/`route\(\)`[^\n]*`theokit\/server\/define`/)
  })
})
