/**
 * The `ts`/`tsx` blocks the published READMEs show must compile, and what a block assumes must be
 * declared rather than guessed.
 *
 * The evidence came from this repository's own work. A gate shipped two hours before this file
 * required a README to call its seam factory in a code block; the example written to satisfy it was
 * `export default { plugins: [copilot({…})] }`, which is not the config surface — the real one is
 * `config().set({...}).build()`, already documented by three sibling packages. Every gate passed
 * it. A human running it against the installed dist caught it.
 *
 * Measured across the eleven published READMEs: 63 blocks, 10 carrying an elision or placeholder,
 * 14 importing a relative module only a reader has, 53 carrying neither. Three attempts at
 * "how many fail to compile" produced 2, 49 and 23 — all wrong, because `./session.js` (a reader's
 * file), `@theokit/orm` (a real package the probe had not installed), `yourSqliteDb` (a
 * placeholder) and a genuinely wrong example are indistinguishable to a compiler.
 *
 * So the marker is the point, not the compiler. `docs/adr/0003` records why it is an HTML comment:
 * 0 of 400 published READMEs in the pnpm store use a fence info string; 39 use HTML comments.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { describe, expect, it } from 'vitest'

import { parseExampleMarkers, splitFences } from '../../../tools/lib/markdown-fences.mjs'

describe('a block declares what it assumes', () => {
  it('carries the prose line immediately above its opener', () => {
    const { blocks } = splitFences(
      '# a\n\n<!-- doc-example: partial -->\n```ts\nconst x = 1\n```\n',
    )

    expect(blocks).toHaveLength(1)
    const [block] = blocks
    expect(block!.precedingLine).toBe('<!-- doc-example: partial -->')
    expect(block!.lang).toBe('ts')
  })

  it('parses the markers a block may declare', () => {
    expect(parseExampleMarkers('<!-- doc-example: partial -->')).toEqual({
      markers: { partial: true, continues: false, needs: [], satisfies: null },
      unknown: [],
    })
    expect(
      parseExampleMarkers('<!-- doc-example: needs="@theokit/orm" needs="react" continues -->'),
    ).toEqual({
      markers: {
        partial: false,
        continues: true,
        needs: ['@theokit/orm', 'react'],
        satisfies: null,
      },
      unknown: [],
    })
  })

  it('reports an unknown key instead of ignoring it', () => {
    // A typo'd marker must not silently downgrade a block to the default. That is the
    // exemption-by-silence two earlier slices in this backlog closed one file at a time.
    const { unknown } = parseExampleMarkers('<!-- doc-example: partail -->')

    expect(unknown).toEqual(['partail'])
  })

  it('does not read an ordinary comment as a marker', () => {
    expect(parseExampleMarkers('<!-- prettier-ignore -->')).toEqual({
      markers: { partial: false, continues: false, needs: [], satisfies: null },
      unknown: [],
    })
  })

  it('reaches its block through blank lines, because the formatter inserts one', () => {
    // Strict adjacency was the first rule and did not survive `pnpm format`: prettier puts a blank
    // line between an HTML comment and the fence below it, deterministically, and orphaned all 41
    // markers on the first run after they were written.
    const { blocks } = splitFences('<!-- doc-example: partial -->\n\n```ts\nconst x = 1\n```\n')

    const [block] = blocks
    expect(parseExampleMarkers(block!.precedingLine).markers.partial).toBe(true)
  })

  it('does not reach its block through prose', () => {
    // Blank lines are transparent; a paragraph is not. A marker left behind by a moved block must
    // not attach to whatever fence happens to follow it — which was the reason for adjacency.
    const { blocks } = splitFences(
      '<!-- doc-example: partial -->\n\nSome prose.\n\n```ts\nconst x = 1\n```\n',
    )

    const [block] = blocks
    expect(parseExampleMarkers(block!.precedingLine).markers.partial).toBe(false)
  })

  it('still returns code and prose for the two gates that already use it', () => {
    // splitFences has two production callers; adding blocks must not reshape what they read.
    const { code, prose } = splitFences('# a\n\n```ts\nconst x = 1\n```\n\n## 2026-08-23\n')

    expect(code.join('\n')).toContain('const x = 1')
    expect(prose.join('\n')).toContain('## 2026-08-23')
    expect(prose.join('\n')).not.toContain('const x = 1')
  })
})
