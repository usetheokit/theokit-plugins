/**
 * Two defects in `@theokit/sdk`'s OAuth transaction cookie — pinned while they were live, and now
 * pinned as FIXED, which is the state this file was written to reach.
 *
 * Neither was ours. Both were in the sdk's built output, and `auth-github`, `auth-google` and
 * `auth-magic-link` could not fix them: they implement a type contract and never construct the
 * orchestrator. What this file did was stop the two facts being rediscovered, and tell us the day
 * they changed. It told us.
 *
 * ── Defect 1: the cookie the callback looked for was never the one sign-in wrote ────────────────
 *
 * `startSignIn` emitted `theo_oauth_tx=` while the transaction store read `__Host-theo_oauth_tx`.
 * The callback therefore never found the transaction, and EVERY OAuth sign-in failed there. It was
 * present in 2.18.0 and still in 4.53.1, so it survived a major release.
 *
 * Fixed in usetheokit/theokit-sdk#377 by exporting the store's constant and using it at the write
 * site: one name rather than two. Shipped in `@theokit/sdk@4.54.0`.
 *
 * ── Defect 2: the transaction secret fell back to a published literal ───────────────────────────
 *
 * `txCookieSecret` tried `opts.session.secret`, then `THEOKIT_OAUTH_TX_SECRET`, then a constant
 * shipped inside the package. The first branch is unreachable for any conforming value —
 * `SessionManager` declares four methods and no `secret`, which the third test still pins — so a
 * deployment setting no environment variable encrypted `state` and `pkceVerifier`, the two values
 * that make an authorization-code flow safe, with a string anybody can read out of npm.
 * `AuthSecretTooShortError` did not fire: the constant is 48 characters and the guard checks
 * length, not provenance.
 *
 * The literal remains, deliberately, as the DEV fallback. What changed is that production refuses
 * it — at wiring time, rather than at a user's first sign-in.
 *
 * The order mattered and is worth recording: fixing the cookie name alone would have made defect 2
 * reachable, because the flow could not complete before. They shipped together.
 *
 * ── Why the assertions are shaped this way ─────────────────────────────────────────────────────
 *
 * They read the INSTALLED artifact rather than citing a path, because a path under `node_modules`
 * moves with the lockfile. And they resolve it through the package under test rather than by
 * scanning the store: three sdk majors sit in this workspace, and "what is installed somewhere" is
 * a different question from "what these packages use".
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * The `@theokit/sdk` the auth packages actually resolve, and its built auth output.
 *
 * Resolved through `packages/auth-github/node_modules/@theokit/sdk` — the symlink pnpm points at
 * the version that package declares. The previous version scanned the workspace `.pnpm` store for
 * the first `@theokit+sdk@2.` directory, which is a different question: it asked what is INSTALLED
 * somewhere rather than what the packages under test USE. Three sdk majors sit in this store, and
 * the answer differed.
 *
 * The cookie name lives in a shared chunk rather than in `server/auth/index.js`, so the whole
 * `dist` is read.
 */
function authArtifact(): { version: string; js: string } {
  const root = join(REPO_ROOT, 'packages', 'auth-github', 'node_modules', '@theokit', 'sdk')
  const version = (
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  ).version

  const js: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      // `.js` only: a `.map` carries the original source text and a `.d.ts` the types, and
      // counting either would measure what the sdk was written as rather than what it ships.
      else if (entry.name.endsWith('.js')) js.push(readFileSync(full, 'utf8'))
    }
  }
  walk(join(root, 'dist'))

  return { version, js: js.join('\n') }
}

describe('@theokit/sdk OAuth transaction cookie — the two defects, now fixed', () => {
  it('writes and reads ONE cookie name, and it carries the __Host- prefix', () => {
    const { version, js } = authArtifact()

    // The defect: `startSignIn` wrote `theo_oauth_tx=` while the transaction store read
    // `__Host-theo_oauth_tx`, so the callback never found what sign-in had written and EVERY
    // OAuth flow failed there. Present in 2.18.0 and still in 4.53.1 — it survived a major.
    //
    // Fixed in usetheokit/theokit-sdk#377 by exporting the store's constant and using it at the
    // write site: one name instead of two. Asserting the COUNT is what makes this about that
    // property rather than about a string existing somewhere.
    const bare = js.replaceAll('__Host-theo_oauth_tx', '@@').match(/theo_oauth_tx/g) ?? []

    expect(
      bare,
      `@theokit/sdk@${version} ships an unprefixed transaction cookie name again — the writer and ` +
        'the store have diverged, which breaks every OAuth callback.',
    ).toEqual([])

    expect(js).toContain('__Host-theo_oauth_tx')
  })

  it('refuses the published fallback secret in production', () => {
    const { version, js } = authArtifact()

    // The other defect: `txCookieSecret` fell back to a 48-character literal shipped inside the
    // package, so a deployment that set no environment variable encrypted `state` and
    // `pkceVerifier` with a string anybody can read out of npm. `AuthSecretTooShortError` did not
    // fire — it checks length, not provenance.
    //
    // The literal still exists, deliberately: it is the DEV fallback, and removing it would make a
    // local sign-in impossible before any secret is configured. What changed is that production
    // now refuses it, at wiring time rather than at a user's first sign-in.
    expect(
      js,
      `@theokit/sdk@${version} no longer guards the fallback secret by NODE_ENV. If the literal is ` +
        'gone entirely, assert that instead and drop the THEOKIT_OAUTH_TX_SECRET note from the ' +
        'three auth READMEs.',
    ).toContain('missing_tx_secret')

    expect(js).toContain('NODE_ENV === "production"')
  })

  it('has no `secret` on the SessionManager the orchestrator is handed', async () => {
    // Unchanged and still worth pinning: it is WHY the first fallback branch was unreachable
    // rather than merely unused. A value satisfying the declared type cannot carry a secret, so
    // `opts.session.secret` is always undefined for a conforming caller — which is what left the
    // published literal as the only remaining source.
    const { createSessionManager } = await import('theokit/server/auth')
    const manager = createSessionManager({
      secret: 'a'.repeat(40),
      cookieName: 'sid',
      // Through `unknown`, because TypeScript refuses the direct conversion — which is itself the
      // finding: `SessionManager` does not overlap a record carrying `secret`.
    }) as unknown as Record<string, unknown>

    expect(
      manager.secret,
      'SessionManager now exposes `secret` — the sdk`s first fallback branch may be reachable, ' +
        'which changes this finding',
    ).toBeUndefined()
  })
})
