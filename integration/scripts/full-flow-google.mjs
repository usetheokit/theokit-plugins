/**
 * Full Google OAuth round trip — the leg the live suite cannot cover.
 *
 * `tests/auth-google/` asserts the exchange's ERROR path, because that is what runs unattended. The
 * success path needs an authorization code, and a code is only issued to a request carrying an
 * authenticated Google session. Measured 2026-08-24: `accounts.google.com/o/oauth2/v2/auth` with
 * this repository's real client id and no cookies answers `302 → /v3/signin/identifier`.
 *
 * That is why this is a script and not a test, and the distinction is sharper than "needs a
 * browser": a headless browser without a session gets the same 302. **The blocker is a session
 * credential.** Automating it means putting a live Google account session into CI, which is an
 * account rather than a scope-limited token — see the caveat in `src/services.ts`.
 *
 * This file exists because `src/harness.ts` skips the round trip with a message telling the reader
 * to "run it locally with the flow:* script for this service". For Google there was none, so the
 * instruction pointed at nothing and this provider's success path was exercised by neither CI nor a
 * documented procedure.
 *
 * What it proves, and nothing else in this repository does:
 *
 *   code -> tokens            the PKCE exchange on the SUCCESS path
 *   id_token -> profile       the OIDC claims this provider maps (sub, email, email_verified)
 *   discovery                 that `discoverOidcProvider` reached Google's real document, since
 *                             the endpoints are not configured — they come from it
 *
 * Run it after changing anything in that path:
 *
 *   pnpm --filter @theokit/plugins-integration flow:google
 *
 * Two rules, inherited from `full-flow-github.mjs` where both were learned by getting them wrong:
 *
 * 1. CLICK THE BUTTON. Driving the consent screen with `btn.click()` from injected JavaScript
 *    produces an untrusted event and can bypass validation the UI applies to a real gesture.
 *
 * 2. REVOKE FIRST, at myaccount.google.com/permissions. Once the app is authorized Google skips the
 *    consent screen and redirects straight through, so a second run silently tests a shorter path
 *    than a first-time user takes, and the screen itself — scopes shown, account chosen — is never
 *    exercised.
 *
 * It starts a callback listener, prints the authorize URL for you to open, captures the code, and
 * reports the SHAPE of the resulting profile — never its contents, because that is a real person's
 * name and address.
 *
 * WHAT HAS AND HAS NOT BEEN VERIFIED (2026-08-24) — read this before trusting it.
 *
 * Verified by running it:
 *   - it starts, and prints an authorize URL on `accounts.google.com/o/oauth2/v2/auth`. That URL is
 *     not configured anywhere: the endpoints come from OIDC discovery, so printing it proves
 *     `discoverOidcProvider` reached Google's real document.
 *   - the DENIAL branch: a callback carrying `?error=access_denied` rejects with
 *     "Google returned access_denied — User denied" instead of hanging until the 120s timer.
 *   - the output carries no email address.
 *
 * NOT verified, and it is the point of the script: **the exchange has never completed here.** That
 * needs a real Google account consenting to this app, which is a person's decision about their own
 * identity and not something a tool should make for them. Whoever runs it first should replace this
 * paragraph with the date and what the shape report said.
 *
 * Shipping it un-completed is deliberate and is still an improvement: before it existed, the skip
 * message in `src/harness.ts` told Google users to run "the flow:* script for this service" and
 * there was none, so the instruction pointed at nothing. A script that says exactly which of its
 * branches have been exercised is a smaller promise than that message was already making.
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { google } from '@theokit/auth-google'

function readEnv() {
  const env = {}
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const i = line.indexOf('=')
      if (i > 0 && !line.trim().startsWith('#'))
        env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
  } catch {
    // fall through to process.env
  }
  return { ...env, ...process.env }
}

const env = readEnv()
const missing = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
].filter((k) => !env[k])
if (missing.length > 0) {
  console.error(`missing ${missing.join(', ')} — see pnpm integration:readiness`)
  process.exit(1)
}

// The port comes from the redirect URI rather than a constant: Google refuses a redirect_uri that
// is not registered exactly, so the listener must be wherever the console says it is.
const redirectUri = new URL(env.GOOGLE_OAUTH_REDIRECT_URI)
const PORT = Number(redirectUri.port || (redirectUri.protocol === 'https:' ? 443 : 80))

const provider = google({
  clientId: env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
})

// A real PKCE verifier, not a fixed string: the live test uses a constant because it only exercises
// the error path, and a constant here would weaken the one thing this script is for.
const tx = {
  state: `full-flow-${Date.now()}`,
  pkceVerifier: randomBytes(48).toString('base64url'),
}

const authorizeUrl = await provider.createAuthorizationURL(tx)

/** Resolves with the code the browser hands back, or rejects on timeout. */
function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`)

      // Google's denial redirect carries ?error=access_denied and no code. Answering 204 and
      // returning would leave the listener open until the timer fired, so clicking "Cancel" would
      // end in "timed out waiting for the consent redirect" — a message about something that did
      // not happen, for a redirect that had already arrived. Same defect fixed in the GitHub
      // script (#98); inherited rather than rediscovered.
      const error = url.searchParams.get('error')
      if (error !== null) {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(`authorization denied: ${error} — you can close this tab`)
        server.close()
        clearTimeout(timer)
        const description = url.searchParams.get('error_description')
        reject(
          new Error(`Google returned ${error}${description === null ? '' : ` — ${description}`}`),
        )
        return
      }

      const code = url.searchParams.get('code')
      if (code === null) {
        // Favicon and any other stray request the browser makes to this port.
        res.writeHead(204).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('code captured — you can close this tab')
      server.close()
      clearTimeout(timer)
      if (url.searchParams.get('state') !== tx.state) {
        reject(new Error('state mismatch on the callback — refusing to exchange'))
        return
      }
      resolve(code)
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('timed out after 120s waiting for the consent redirect'))
    }, 120_000)
    server.listen(PORT, () => {
      process.stdout.write(
        `\nlistening on http://localhost:${PORT}\n\nOpen this and authorize:\n\n${authorizeUrl}\n\n`,
      )
    })
  })
}

const code = await waitForCode()

const result = await provider.handleCallback(
  {
    url: `${redirectUri.pathname}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(tx.state)}`,
    headers: { host: `localhost:${PORT}` },
  },
  tx,
)

const p = result.profile
// Shape, never contents: this is a real account's name and address.
const report = {
  providerName: result.providerName,
  hasAccessToken:
    typeof result.rawTokens?.accessToken === 'string' && result.rawTokens.accessToken.length > 0,
  profile: {
    subIsNonEmptyString: typeof p.sub === 'string' && p.sub.length > 0,
    // Reported as a category rather than a value. `set-with-@` is the only shape that proves the
    // claim came back as an address at all, which is what the provider maps it as.
    email:
      typeof p.email !== 'string' || p.email.length === 0
        ? 'MISSING'
        : p.email.includes('@')
          ? 'set-with-@'
          : 'set-invalid',
    emailVerifiedIsBoolean: typeof p.email_verified === 'boolean',
    name: p.name === undefined ? 'absent' : 'set',
    pictureIsHttps: p.picture === undefined ? 'absent' : String(p.picture).startsWith('https://'),
  },
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

const ok =
  report.hasAccessToken &&
  report.profile.subIsNonEmptyString &&
  report.profile.email === 'set-with-@' &&
  report.profile.emailVerifiedIsBoolean
process.stdout.write(ok ? '\nround trip OK\n' : '\nround trip INCOMPLETE — see the shape above\n')
process.exit(ok ? 0 : 1)
