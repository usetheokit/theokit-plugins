/**
 * Two defects in `@theokit/sdk`'s OAuth transaction cookie, pinned so we learn when they are fixed.
 *
 * Neither is ours. Both are in the sdk's built output, and `auth-github`, `auth-google` and
 * `auth-magic-link` declare `^2.18.0` as a PEER — so every consumer installing them gets a version
 * that has them, and none of the three can fix it. They implement a type contract and never
 * construct the orchestrator, so there is no seam here to guard.
 *
 * What this file does is stop the two facts being rediscovered, and tell us the day they change.
 *
 * ── Defect 1: the transaction secret falls back to a published literal ──────────────────────────
 *
 * `txCookieSecret` tries `opts.session.secret`, then `THEOKIT_OAUTH_TX_SECRET`, then a constant
 * that ships inside the package. The FIRST branch is unreachable for any conforming value:
 * `DefineAuthOptions.session` is typed `SessionManager<TSession>`, which declares four methods and
 * no `secret`. So unless a deployment sets the environment variable, the cookie carrying `state`
 * and `pkceVerifier` — the two values that make an authorization-code flow safe against CSRF and
 * code interception — is encrypted with a string anybody can read out of npm.
 *
 * `AuthSecretTooShortError` does not fire: the constant is 48 characters, and the guard checks
 * length rather than provenance.
 *
 * ── Defect 2: the cookie is written under a name nothing reads ──────────────────────────────────
 *
 * The store declares and reads `__Host-theo_oauth_tx`; the writer emits `theo_oauth_tx`. Two
 * consequences, and the second is why the first is latent:
 *
 *   - the `__Host-` guarantee is lost — without the prefix a sibling subdomain can set the cookie,
 *     and the store's own docstring cites RFC 6265bis for exactly that reason;
 *   - the callback cannot find the transaction it wrote, so the flow does not complete — which is
 *     what keeps defect 1 from being exploitable today, and what makes it exploitable the moment
 *     the name is fixed.
 *
 * ── Why these assertions are shaped this way ────────────────────────────────────────────────────
 *
 * They read the INSTALLED artifact rather than citing a path, because a path under `node_modules`
 * moves with the lockfile. And they assert the defects are PRESENT: when the sdk fixes either, this
 * file goes red and asks to be updated, which is the notification this repository actually needs.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** The built auth module of whichever `@theokit/sdk` the auth packages resolve. */
function authModuleSource(): { version: string; source: string } {
  const store = join(REPO_ROOT, 'node_modules', '.pnpm')
  // The 2.x install is the one the auth packages' `^2.18.0` peer range admits. A 4.x copy is also
  // present in this workspace, pulled by `theokit` itself, and it is a different contract.
  const dir = readdirSync(store).find((d) => d.startsWith('@theokit+sdk@2.'))
  if (dir === undefined) {
    throw new Error(
      'no @theokit/sdk 2.x in the store — the auth packages declare ^2.18.0, so either the range ' +
        'moved or the install did. Either way this pin needs revisiting rather than skipping.',
    )
  }
  const root = join(store, dir, 'node_modules', '@theokit', 'sdk')
  return {
    version: (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string })
      .version,
    source: readFileSync(join(root, 'dist', 'server', 'auth', 'index.js'), 'utf8'),
  }
}

describe('@theokit/sdk 2.x OAuth transaction cookie', () => {
  it('still falls back to a secret published inside the package', () => {
    const { version, source } = authModuleSource()

    expect(
      source,
      `@theokit/sdk@${version} no longer ships the fallback transaction secret. If it now refuses ` +
        'to boot without a real one, delete this test and drop the THEOKIT_OAUTH_TX_SECRET note ' +
        'from the three auth READMEs.',
    ).toContain('DEV_ONLY_INSECURE_OAUTH_TX_SECRET_REPLACE_IN_PROD')
  })

  it('still writes the transaction cookie without the __Host- prefix its store reads', () => {
    const { version, source } = authModuleSource()

    // The store's constant — what the callback looks for.
    expect(source).toContain('__Host-theo_oauth_tx')

    // The writer's template — what actually reaches the browser. Asserting the unprefixed form
    // appears OUTSIDE the prefixed constant is what makes this about the mismatch rather than
    // about the string existing at all.
    const unprefixed = source.replaceAll('__Host-theo_oauth_tx', '')
    expect(
      unprefixed,
      `@theokit/sdk@${version} may have fixed the cookie-name mismatch. If the writer now emits ` +
        'the prefixed name, this test should assert that instead — and note that fixing this makes ' +
        'the fallback-secret defect reachable, so the two are worth fixing in that order.',
    ).toContain('theo_oauth_tx=')
  })

  it('has no `secret` on the SessionManager the orchestrator is handed', async () => {
    // Why the first fallback branch is unreachable rather than merely unused: a value satisfying
    // the declared type cannot carry a secret, so `opts.session.secret` is always undefined for a
    // conforming caller.
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
