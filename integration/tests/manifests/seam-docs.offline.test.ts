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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

  it('fails when the registry parses fewer rows than there are packages', () => {
    // The vacuous-pass guard. If the registry's shape moves, every assertion above becomes a
    // comparison over an empty list — and the run would otherwise print a clean summary it did
    // not earn.
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

    expect(code, 'a partial registry parse was reported as a clean run').toBe(1)
    expect(output).toMatch(/the registry's shape moved/)
  })

  it("passes against this repository, including plugin-copilot's corrected README", () => {
    const { code, output } = validate(REPO_ROOT)

    expect(code).toBe(0)
    // Anchored on the count so the assertion cannot be satisfied by a run that checked nothing.
    expect(output).toMatch(/names its factory in its README \(7 checked\)/)
  })
})
