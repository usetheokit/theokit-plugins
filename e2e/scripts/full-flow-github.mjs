/**
 * Full GitHub OAuth round trip — the leg the live suite cannot cover.
 *
 * The suite in `tests/auth-github/` asserts the token exchange's ERROR path,
 * because that is what runs unattended. The success path needs an authorization
 * code, and a code is only issued to a browser redirect after somebody clicks
 * "Authorize". That makes it impossible in CI and perfectly possible here, on a
 * machine with a logged-in browser — a distinction the first version of this
 * package got wrong by calling the round trip simply "unreachable".
 *
 * What it proves, and nothing else in this repository does:
 *
 *   code -> access token        githubExchangeToken on the SUCCESS path
 *   token -> /user              githubFetchUser, including that GitHub still
 *                               accepts the legacy `Authorization: token X`
 *                               header this plugin sends (not `Bearer`)
 *   token -> /user/emails       githubResolveEmail, which needs the user:email
 *                               scope and is otherwise never executed
 *
 * Run it after changing anything in that path:
 *
 *   pnpm --filter @theokit/plugins-e2e flow:github
 *
 * Two rules for doing it properly, both learned by doing it wrong first:
 *
 * 1. CLICK THE BUTTON. Driving the consent screen with `btn.click()` from
 *    injected JavaScript is not the same interaction: it produces an untrusted
 *    event and can bypass validation the UI applies to a real gesture. Use the
 *    browser's own input dispatch (Chrome DevTools `click` on the element), which
 *    is what a person's mouse does.
 *
 * 2. REVOKE FIRST, at
 *    github.com/settings/connections/applications/<client_id>. Once the app is
 *    authorized, GitHub skips the consent screen and redirects straight through —
 *    so a second run silently tests a shorter path than a first-time user takes,
 *    and the consent screen itself (scopes shown, redirect warned) is never
 *    exercised. Verified 2026-08-17: after revoking, the screen came back, listed
 *    "Email addresses (read-only), profile information (read-only)", and warned
 *    that localhost:3000 is "Not owned or operated by GitHub".
 *
 * It starts a callback listener on 127.0.0.1:3000, prints the authorize URL for
 * you to open, captures the code, and reports the SHAPE of the resulting
 * profile — never its contents, because that is a real person's name and email.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

import { github } from '@theokit/auth-github'

const PORT = 3000

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
const missing = ['GH_OAUTH_CLIENT_ID', 'GH_OAUTH_CLIENT_SECRET', 'GH_OAUTH_CALLBACK_URL'].filter(
  (k) => !env[k],
)
if (missing.length > 0) {
  console.error(`missing ${missing.join(', ')} — see pnpm e2e:readiness`)
  process.exit(1)
}

const state = `full-flow-${Date.now()}`
const authorizeUrl = `https://github.com/login/oauth/authorize?${new URLSearchParams({
  client_id: env.GH_OAUTH_CLIENT_ID,
  redirect_uri: env.GH_OAUTH_CALLBACK_URL,
  scope: 'read:user user:email',
  state,
  response_type: 'code',
})}`

/** Resolves with the code the browser hands back, or rejects on timeout. */
function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`)
      const code = url.searchParams.get('code')
      if (code === null) {
        res.writeHead(204).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('code captured — you can close this tab')
      server.close()
      clearTimeout(timer)
      if (url.searchParams.get('state') !== state) {
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

const provider = github({
  clientId: env.GH_OAUTH_CLIENT_ID,
  clientSecret: env.GH_OAUTH_CLIENT_SECRET,
  redirectUri: env.GH_OAUTH_CALLBACK_URL,
  scopes: ['read:user', 'user:email'],
})

const result = await provider.handleCallback(
  {
    url: `/api/auth/callback/github?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    headers: { host: `localhost:${PORT}` },
  },
  { state },
)

const p = result.profile
// Shape, never contents: this is a real account's name and address.
const report = {
  providerName: result.providerName,
  hasAccessToken:
    typeof result.rawTokens?.accessToken === 'string' && result.rawTokens.accessToken.length > 0,
  profile: {
    idIsNumber: Number.isInteger(p.id),
    login: typeof p.login === 'string' && p.login.length > 0 ? 'set' : 'MISSING',
    name: p.name === null ? 'null' : 'set',
    email:
      p.email === null
        ? 'null (user:email scope missing or all private)'
        : String(p.email).includes('@')
          ? 'set-with-@'
          : 'set-invalid',
    avatarIsHttps: typeof p.avatar_url === 'string' && p.avatar_url.startsWith('https://'),
  },
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

const ok =
  report.hasAccessToken &&
  report.profile.idIsNumber &&
  report.profile.login === 'set' &&
  report.profile.avatarIsHttps
process.exitCode = ok ? 0 : 1
