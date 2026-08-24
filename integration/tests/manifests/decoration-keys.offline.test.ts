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

/**
 * A fixture repo whose packages are `private`, so only the new check can fail them.
 *
 * A package is either a single `src/plugin.ts` source, or a map of `src/`-relative filenames to
 * sources — the second form is what lets a test put a key's const in one file and its call site
 * in another, which is the refactor that defeated the first version of this check.
 */
function fixture(packages: Record<string, string | Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'deco-keys-'))
  created.push(root)
  for (const [name, spec] of Object.entries(packages)) {
    const dir = join(root, 'packages', name)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: `@fixture/${name}`, version: '0.0.0', private: true }),
    )
    const files = typeof spec === 'string' ? { 'plugin.ts': spec } : spec
    for (const [rel, source] of Object.entries(files)) {
      writeFileSync(join(dir, 'src', rel), source)
    }
  }
  return root
}

/**
 * Run the validator in `cwd`; return its exit code and BOTH streams.
 *
 * Both, deliberately: the unresolved-key notices go to stderr so they are visible beside the
 * violations, and a helper that returned only stdout on success could not see them — which is how
 * an assertion about them passed for the wrong reason once already.
 */
function validate(cwd: string): { code: number; output: string } {
  const result = spawnSync('node', [SCRIPT], { cwd, encoding: 'utf8' })
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
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

    expect(code, 'the duplicate was accepted').toBe(1)
    // Anchored on the message, not on the fixture paths: `/alpha/` alone matched any output that
    // merely mentioned the temp directory.
    expect(output).toMatch(/decoration key `payments` is claimed by 2 packages/)
    expect(output, 'the failure names only one side of the collision').toMatch(
      /alpha\/src\/plugin\.ts:\d+/,
    )
    expect(output).toMatch(/beta\/src\/plugin\.ts:\d+/)
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
export const DECORATION_KEY = '${pkg}-key'
export function plugin() {
  // app.decorateRequest('ghost', {})
  return { name: '@fixture/${pkg}', register(app) { app.decorateRequest(DECORATION_KEY, {}) } }
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

  it('sees a key whose const lives in another file of the same package', () => {
    // The refactor that defeated the first version of this check: resolution was same-file only,
    // so moving a key's const into its own module turned a real collision into an unresolved
    // line — and the run still printed a green summary claiming no two packages collided.
    const root = fixture({
      alpha: {
        'keys.ts': `export const K = 'payments'`,
        'plugin.ts': `import { K } from './keys.js'
export const p = { name: 'a', register(app) { app.decorateRequest(K, {}) } }`,
      },
      beta: claiming('beta', 'payments'),
    })

    expect(validate(root).code).not.toBe(0)
  })

  it("sees a key written as `'…' as const`", () => {
    // Idiomatic TypeScript, and it wraps the literal in an AsExpression rather than leaving a
    // StringLiteral — so a resolver that only matched literals dropped it.
    const root = fixture({
      alpha: `const K = 'payments' as const
export const p = { name: 'a', register(app) { app.decorateRequest(K, {}) } }`,
      beta: claiming('beta', 'payments'),
    })

    expect(validate(root).code).not.toBe(0)
  })

  it('does not treat one package claiming a key twice as a collision', () => {
    // The property is "two PACKAGES", not "two call sites". Without this, deriving the package
    // could be broken outright and the whole suite would still pass — measured: it did.
    const root = fixture({
      // The key is an exported const because the form rule below requires it; this case is about
      // "two call sites in one package are not a collision", and keeping the two concerns separate
      // is what stops one test failing for the other's reason.
      alpha: `export const DECORATION_KEY = 'shared'
export const p = { name: 'a', register(app) {
  app.decorateRequest(DECORATION_KEY, {})
  app.decorateRequest(DECORATION_KEY, {})
} }`,
    })

    expect(validate(root).code).toBe(0)
  })

  it('reads a key claimed from a .tsx file', () => {
    // The extension pattern could be narrowed to `.ts` and every other test here would still
    // pass — measured. A React-surface package claiming a key is exactly the case that widening
    // was for.
    const root = fixture({
      alpha: {
        'ui.tsx': `export const p = { register(app) { app.decorateRequest('payments', {}) } }`,
      },
      beta: claiming('beta', 'payments'),
    })

    expect(validate(root).code).not.toBe(0)
  })

  it('refuses to claim it compared keys it could not resolve', () => {
    // The summary line used to be unconditional: a run that resolved nothing still printed
    // "no two packages claim the same key". That is a green line the run did not earn.
    const root = fixture({
      alpha: `const KEYS = { payments: 'payments' }
export const p = { name: 'a', register(app) { app.decorateRequest(KEYS.payments, {}) } }`,
    })

    const { code, output } = validate(root)

    expect(code).toBe(0)
    expect(output, 'claimed a clean comparison it did not make').not.toMatch(/no two packages/)
    expect(output).toMatch(/could NOT be resolved/)
  })
})

describe('a decoration key must be an importable const, not a literal', () => {
  // `.claude/rules/decoration-keys.md § 2` requires the key to be "declared as an exported `const`
  // beside the plugin so a consumer can import it rather than retype it". Until this existed the
  // gate compared VALUES only, so `'stripe'` and `STRIPE_DECORATION_KEY` were indistinguishable to
  // it — correct for collision detection, and blind to the form.
  //
  // A consumer who retypes a key gets a silent `undefined` at request time when they mistype it.
  // That is the cost the convention exists to remove, and a rule nothing enforces is a rule that
  // decays: three keys existed and one had already drifted.

  it('fails on a key passed as an inline string literal', () => {
    const root = fixture({
      solo: `
export function plugin() {
  return { name: '@fixture/solo', register(app) { app.decorateRequest('thing', {}) } }
}
`,
    })

    const { code, output } = validate(root)

    expect(code).not.toBe(0)
    // The file AND the line: a gate that fails without saying where is a gate people disable.
    expect(output).toMatch(/packages.solo.src.plugin\.ts:\d+/)
    expect(output).toMatch(/literal/i)
  })

  it('fails on an identifier resolving to a const that is not exported', () => {
    // The half that is easy to miss. A check asking only "identifier or literal?" accepts this —
    // and a module-local const is one a consumer still cannot import, so the gate would report
    // compliance for a key that does not deliver the thing the convention is for.
    const root = fixture({
      local: `
const DECORATION_KEY = 'thing'
export function plugin() {
  return { name: '@fixture/local', register(app) { app.decorateRequest(DECORATION_KEY, {}) } }
}
`,
    })

    const { code, output } = validate(root)

    expect(code).not.toBe(0)
    expect(output).toMatch(/export/i)
  })

  it('accepts an exported const declared in a different file of the same package', () => {
    // Splitting a const into its own module is an ordinary refactor, and the collision check was
    // once broken by exactly it (`scripts/validate-manifests.mjs:387`). The form rule must not
    // reintroduce that: resolution is package-wide, so this passes.
    const root = fixture({
      split: {
        'keys.ts': `export const DECORATION_KEY = 'thing'
`,
        'plugin.ts': `
import { DECORATION_KEY } from './keys.js'
export function plugin() {
  return { name: '@fixture/split', register(app) { app.decorateRequest(DECORATION_KEY, {}) } }
}
`,
      },
    })

    expect(validate(root).code).toBe(0)
  })

  it('fires through the element-access form too', () => {
    // `app['decorateRequest'](…)` is the bypass the collision check already closes
    // (`scripts/validate-manifests.mjs:426`). If the form rule did not reach through it, the
    // documented bypass would become the supported way to keep an inline literal.
    const root = fixture({
      elem: `
export function plugin() {
  return { name: '@fixture/elem', register(app) { app['decorateRequest']('thing', {}) } }
}
`,
    })

    expect(validate(root).code).not.toBe(0)
  })

  it('leaves an unresolvable key on the report channel, not the failure channel', () => {
    // The `ℹ` channel is an honest report of what the parser cannot see
    // (`.claude/rules/decoration-keys.md § 3`). A literal is fully resolved — the parser knows
    // exactly what it is — so failing both on the same channel would blur a known violation with
    // an acknowledged blind spot, and the blind-spot channel is the one that must stay readable.
    const root = fixture({
      dynamic: `
const KEYS = { thing: 'thing' }
export function plugin() {
  return { name: '@fixture/dynamic', register(app) { app.decorateRequest(KEYS.thing, {}) } }
}
`,
    })

    const { code, output } = validate(root)

    expect(code).toBe(0)
    expect(output).toMatch(/unresolved decoration key/i)
  })
})
