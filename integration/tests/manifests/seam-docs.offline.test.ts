/**
 * A package that declares a seam must name that seam's factory in its README.
 *
 * Measured on `plugin-copilot` before this existed: it is declared `seam: 'plugin'`, its
 * `register()` decorates the request, and the conformance suite proves the real runner accepts it
 * — while `copilot(`, `plugins:` and `theo.config` appeared **zero times** in its README, and its
 * npm description named `defineCopilot` instead.
 *
 * A developer following that documentation exports a `defineCopilot` and stops. The plugin is
 * never registered, `ctx.copilot` is never decorated, and nothing fails — because an unregistered
 * plugin is indistinguishable from a plugin nobody wrote.
 *
 * The check asserts PRESENCE, not correctness: a README naming the factory once in passing
 * satisfies it. That false negative is deliberate, and the tests below pin it rather than pretend
 * otherwise — encoding one documentation shape would fail packages that legitimately document
 * differently, and a gate people work around is worse than a floor.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SCRIPT = join(REPO_ROOT, 'scripts', 'validate-manifests.mjs')

const created: string[] = []

afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true })
})

interface FixturePackage {
  readonly seam: 'plugin' | 'auth' | 'none'
  readonly factory?: string
  readonly reason?: string
  readonly readme: string
}

/**
 * A fixture repo carrying its own seam registry at the path the script reads.
 *
 * The registry is written as TypeScript because the script parses it with the compiler — writing
 * JSON here would test a different code path than the one that ships.
 */
function fixture(packages: Record<string, FixturePackage>): string {
  const root = mkdtempSync(join(tmpdir(), 'seam-docs-'))
  created.push(root)

  const rows: string[] = []
  for (const [name, spec] of Object.entries(packages)) {
    const dir = join(root, 'packages', name)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: `@fixture/${name}`, version: '0.0.0', private: true }),
    )
    writeFileSync(join(dir, 'src', 'plugin.ts'), 'export const noop = 1\n')
    writeFileSync(join(dir, 'README.md'), spec.readme)

    const fields = [`pkg: '${name}'`, `seam: '${spec.seam}'`]
    if (spec.factory) fields.push(`factory: '${spec.factory}'`)
    if (spec.reason) fields.push(`reason: '${spec.reason}'`)
    rows.push(`  { ${fields.join(', ')} },`)
  }

  mkdirSync(join(root, 'integration', 'src'), { recursive: true })
  writeFileSync(
    join(root, 'integration', 'src', 'integrating-packages.ts'),
    `export const INTEGRATING_PACKAGES = [\n${rows.join('\n')}\n]\n`,
  )
  return root
}

function validate(cwd: string): { code: number; output: string } {
  const result = spawnSync('node', [SCRIPT], { cwd, encoding: 'utf8' })
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('a package with a seam names its factory in its README', () => {
  it('fails when the README never calls the factory', () => {
    const root = fixture({
      alpha: { seam: 'plugin', factory: 'alphaPlugin', readme: '# alpha\n\nUse defineThing().\n' },
    })

    const { code, output } = validate(root)

    expect(code, 'a README that never names its factory was accepted').toBe(1)
    expect(output).toMatch(/alpha: no code block in the README calls `alphaPlugin\(\)`/)
    expect(output, 'the failure does not say which seam').toMatch(/`plugin` seam/)
  })

  it('passes when the README calls the factory', () => {
    const root = fixture({
      alpha: {
        seam: 'plugin',
        factory: 'alphaPlugin',
        readme: '# alpha\n\n```ts\nexport default { plugins: [alphaPlugin()] }\n```\n',
      },
    })

    expect(validate(root).code).toBe(0)
  })

  it('does not accept a prose mention in place of a code example', () => {
    // Found by integration validation, not by review: deleting the wiring example from
    // plugin-copilot's README left the sentence "`copilot()` returns a TheoPlugin" behind, and a
    // presence-anywhere check stayed green. A sentence satisfies a search and shows the reader
    // nothing to copy.
    const root = fixture({
      alpha: {
        seam: 'plugin',
        factory: 'alphaPlugin',
        readme: '# alpha\n\nCall `alphaPlugin()` to build the plugin.\n\n```ts\nconst x = 1\n```\n',
      },
    })

    const { code, output } = validate(root)

    expect(code, 'a prose-only mention was accepted as documentation').toBe(1)
    expect(output).toMatch(/no code block in the README calls/)
  })

  it.each([
    ['an info string on the fence', '# a\n\n```ts title="theo.config.ts"\nalphaPlugin()\n```\n'],
    ['CRLF line endings', '# a\r\n\r\n```ts\r\nalphaPlugin()\r\n```\r\n'],
    [
      'a fence indented inside a list item',
      '# a\n\n1. Step\n\n   ```ts\n   alphaPlugin()\n   ```\n',
    ],
    ['a tilde fence', '# a\n\n~~~ts\nalphaPlugin()\n~~~\n'],
    ['a four-space indented block', '# a\n\n    alphaPlugin()\n'],
    ['an uppercase language tag', '# a\n\n```TS\nalphaPlugin()\n```\n'],
  ])('accepts correct documentation written with %s', (_label, readme) => {
    // Every one of these was REJECTED by the paired regex this replaced. The CRLF case is the
    // operational one: there is no `.gitattributes` here, so a Windows clone with
    // core.autocrlf=true would have failed all seven seam packages with a message blaming the
    // documentation.
    const root = fixture({ alpha: { seam: 'plugin', factory: 'alphaPlugin', readme } })

    expect(validate(root).code, 'correct documentation was rejected').toBe(0)
  })

  it('does not let an unrecognized fence turn prose into code', () => {
    // The failure that mattered most: an opener the regex could not parse was not skipped, it
    // DESYNCHRONISED the pairing — so the next fence became an opener and the prose between two
    // blocks was captured as code. That silently restored the prose-tolerant behaviour this
    // check exists to replace.
    const root = fixture({
      alpha: {
        seam: 'plugin',
        factory: 'alphaPlugin',
        readme:
          '# a\n\n```ts title="x"\nconst z = 1\n```\n\nCall `alphaPlugin()` here.\n\n```ts\nconst y = 2\n```\n',
      },
    })

    expect(validate(root).code, 'prose between two code blocks was read as code').toBe(1)
  })

  it('does not harvest a row from an object literal that is not in the registry', () => {
    // The walk used to collect ANY object literal carrying `pkg` and `seam` — including examples
    // in helpers and JSDoc. That invented violations naming packages that do not exist, and with
    // `seam: 'none'` silently inflated the count the vacuous-pass guard trusted.
    const root = fixture({
      alpha: {
        seam: 'plugin',
        factory: 'alphaPlugin',
        readme: '# a\n\n```ts\nalphaPlugin()\n```\n',
      },
    })
    const registry = join(root, 'integration', 'src', 'integrating-packages.ts')
    writeFileSync(
      registry,
      `export function example() {\n  return { pkg: 'ghost', seam: 'plugin', factory: 'ghostFactory' }\n}\n` +
        readFileSync(registry, 'utf8'),
    )

    const { code, output } = validate(root)

    expect(code).toBe(0)
    expect(output, 'a phantom row was harvested from a helper').not.toMatch(/ghost/)
  })

  it('reports a row whose field is not a string literal instead of dropping it', () => {
    const root = fixture({
      alpha: {
        seam: 'plugin',
        factory: 'alphaPlugin',
        readme: '# a\n\n```ts\nalphaPlugin()\n```\n',
      },
    })
    writeFileSync(
      join(root, 'integration', 'src', 'integrating-packages.ts'),
      `const PLUGIN = 'plugin'\nexport const INTEGRATING_PACKAGES = [\n  { pkg: 'alpha', seam: PLUGIN, factory: 'alphaPlugin' },\n]\n`,
    )

    const { code, output } = validate(root)

    expect(code, 'a row the parser could not read was dropped silently').toBe(1)
    expect(output).toMatch(/not a string literal/)
  })

  it('does not claim a clean check when there is no registry at all', () => {
    // Same lesson as the decoration-key check one function over: a summary that claims success
    // after checking nothing is a green line the run did not earn.
    const root = fixture({ alpha: { seam: 'plugin', factory: 'alphaPlugin', readme: '# a\n' } })
    rmSync(join(root, 'integration'), { recursive: true, force: true })

    const { code, output } = validate(root)

    expect(code).toBe(0)
    expect(output, 'reported a clean check having checked nothing').not.toMatch(
      /✓ every package with a seam/,
    )
    expect(output).toMatch(/no seam registry found/)
  })

  it('asks nothing of a package that plugs into nothing', () => {
    const root = fixture({
      alpha: {
        seam: 'none',
        reason: 'React and Zod only, no server seam here',
        readme: '# alpha\n',
      },
    })

    expect(validate(root).code).toBe(0)
  })

  it('fails when a seam row names no factory, rather than checking nothing', () => {
    // A row with a seam and no factory gives the check nothing to look for — and a check with
    // nothing to look for passes silently, which is the shape two gates in this repository
    // already shipped with.
    const root = fixture({
      alpha: { seam: 'plugin', readme: '# alpha\n' },
    })

    const { code, output } = validate(root)

    expect(code).toBe(1)
    expect(output).toMatch(/names no factory/)
  })

  it('fails when a package on disk has no registry row', () => {
    // The vacuous-pass guard, compared as SETS. Comparing counts let a stale row for a deleted
    // package pay for a live package with no row at all: the numbers matched, the guard stayed
    // quiet, and the live package was never checked.
    const root = fixture({
      alpha: {
        seam: 'plugin',
        factory: 'alphaPlugin',
        readme: '# alpha\n\nalphaPlugin()\n',
      },
    })
    // A second package on disk that the registry does not mention.
    const orphan = join(root, 'packages', 'beta')
    mkdirSync(join(orphan, 'src'), { recursive: true })
    writeFileSync(
      join(orphan, 'package.json'),
      JSON.stringify({ name: '@fixture/beta', version: '0.0.0', private: true }),
    )
    writeFileSync(join(orphan, 'README.md'), '# beta\n')

    const { code, output } = validate(root)

    expect(code, 'a package with no registry row was reported as a clean run').toBe(1)
    expect(output).toMatch(/has no row for 1 package\(s\) with a manifest: beta/)
  })

  it("passes against this repository, including plugin-copilot's corrected README", () => {
    const { code, output } = validate(REPO_ROOT)

    expect(code).toBe(0)
    // Anchored on the count so the assertion cannot be satisfied by a run that checked nothing.
    expect(output).toMatch(/names its factory in its README \(7 checked\)/)
  })
})
