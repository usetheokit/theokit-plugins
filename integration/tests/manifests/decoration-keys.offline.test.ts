/**
 * Two packages may not claim the same request-decoration key.
 *
 * Measured against theokit 0.48.8 before this existed: two plugins with distinct names claiming
 * one key are BOTH registered without error, and `applyDecorations` overwrites last-writer-wins,
 * so a request context holds `{"payments":"FROM-SECOND"}` — the first plugin's decoration is gone
 * from what a handler reads. `DuplicateDecorationError` is exported but constructed in 0 of 160
 * `.js` files under `theokit/dist`; the runner's own comment records the permissiveness as
 * deliberate ("Cross-plugin decoration-key collisions are PERMITTED (per blueprint D1)").
 *
 * So the framework will not refuse a collision, and nothing else in this repository reads
 * decoration keys. `pnpm check:manifests` is the only place it can be caught before a consumer's
 * app — where the symptom would be a handler reading `ctx.payments` and receiving whatever the
 * last-registered plugin put there, moving when the consumer reorders their own config.
 *
 * The script resolves `packages/` relative to its cwd, so each case runs it against a temporary
 * fixture rather than against this repository. One case runs it against the real tree, so the
 * check cannot be satisfied by failing on everything.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { execFileSync } from 'node:child_process'
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

/** A fixture repo whose packages are `private`, so only the new check can fail them. */
function fixture(packages: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'deco-keys-'))
  created.push(root)
  for (const [name, source] of Object.entries(packages)) {
    const dir = join(root, 'packages', name)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: `@fixture/${name}`, version: '0.0.0', private: true }),
    )
    writeFileSync(join(dir, 'src', 'plugin.ts'), source)
  }
  return root
}

/** Run the validator in `cwd`; return its exit code and combined output. */
function validate(cwd: string): { code: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT], { cwd, encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, output }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const claiming = (pkg: string, key: string) => `
export const DECORATION_KEY = '${key}'
export function plugin() {
  return { name: '@fixture/${pkg}', register(app) { app.decorateRequest(DECORATION_KEY, {}) } }
}
`

describe('two packages may not claim the same decoration key', () => {
  it('fails when two packages claim one key, naming both files and the key', () => {
    const root = fixture({
      alpha: claiming('alpha', 'payments'),
      beta: claiming('beta', 'payments'),
    })

    const { code, output } = validate(root)

    expect(code, 'the duplicate was accepted').not.toBe(0)
    expect(output).toMatch(/payments/)
    expect(output, 'the failure names only one side of the collision').toMatch(/alpha/)
    expect(output).toMatch(/beta/)
  })

  it('points at the rule rather than sending the reader to grep', () => {
    const root = fixture({
      alpha: claiming('alpha', 'payments'),
      beta: claiming('beta', 'payments'),
    })

    expect(validate(root).output).toMatch(/decoration-keys/)
  })

  it('passes when the keys differ', () => {
    const root = fixture({
      alpha: claiming('alpha', 'alpha-thing'),
      beta: claiming('beta', 'beta-thing'),
    })

    expect(validate(root).code).toBe(0)
  })

  it('does not read a key out of a comment', () => {
    // The #99 defect, written as a test before the code exists: a regex over the source would
    // count `ghost` twice here and fail a repository that has no collision at all.
    const commented = (pkg: string) => `
/**
 * Example — a plugin claims its key like this:
 *   app.decorateRequest('ghost', {})
 */
export function plugin() {
  // app.decorateRequest('ghost', {})
  return { name: '@fixture/${pkg}', register(app) { app.decorateRequest('${pkg}-key', {}) } }
}
`
    const root = fixture({ alpha: commented('alpha'), beta: commented('beta') })

    const { code, output } = validate(root)

    expect(code, 'a commented call was counted as a declaration').toBe(0)
    expect(output).not.toMatch(/ghost/)
  })

  it('reports a key it cannot resolve instead of skipping it', () => {
    // A computed key cannot be resolved statically. Silence would be the exemption-by-silence
    // B-001 spent a cycle removing; failing would invent a rule for a case nobody has.
    const computed = `
export function plugin(suffix) {
  return { name: '@fixture/alpha', register(app) { app.decorateRequest(\`key-\${suffix}\`, {}) } }
}
`
    const root = fixture({ alpha: computed })

    const { code, output } = validate(root)

    expect(code, 'an unresolvable key must not fail the build').toBe(0)
    expect(output, 'an unresolvable key was skipped silently').toMatch(
      /unresolved|could not resolve/i,
    )
  })

  it('passes against this repository, so it cannot be satisfied by failing on everything', () => {
    expect(validate(REPO_ROOT).code).toBe(0)
  })
})
