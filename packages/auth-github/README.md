# @theokit/auth-github

GitHub OAuth 2.0 provider for [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) auth orchestrator (`Auth.create`).

OAuth 2.0 only (GitHub does not expose OIDC discovery and does not implement PKCE). Hardcoded GitHub endpoints; overridable for GitHub Enterprise Server.

## Install

```bash
pnpm add @theokit/auth-github @theokit/sdk theokit
```

Peer dependencies: `@theokit/sdk >= 1.5.0`, `theokit >= 0.2.4`.

## Usage

<!-- doc-example: needs="./session.js" -->

```ts
// server/auth/index.ts
import { Auth } from '@theokit/sdk/server/auth'
import { github, type GitHubProfile } from '@theokit/auth-github'
import { sessionManager } from './session.js'

// `Auth.create`, not `Auth.create`. The function existed in `@theokit/sdk` 2.x and is gone
// from 4.x, which is what npm serves; the options are unchanged, only the entry point moved.
export const auth = Auth.create({
  session: sessionManager,
  providers: [
    github({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      redirectUri: 'https://myapp.com/api/auth/github/callback',
    }),
  ],
  onSignIn: async ({ profile }) => {
    // `onSignIn` is typed `<TProfile>(args: { profile: TProfile; … })` — TProfile is unbound, so
    // the callback cannot annotate it and the cast is what a consumer actually writes.
    const p = profile as GitHubProfile
    return { userId: String(p.id), email: p.email, login: p.login }
  },
})
```

Wire into your routes:

<!-- doc-example: needs="../../../auth/index.js" -->

```ts
// server/routes/auth/github/start.ts
import { generateOAuthState } from 'theokit/server/auth'
import { route } from 'theokit/server'
import { provider, saveTransaction } from '../../../auth/index.js'

export const GET = route()
  // Public because the visitor arrives WITHOUT a session — starting or finishing a
  // sign-in is what gives them one. Writing it is a decision, not a formality: it is
  // what tells a reader this route is open on purpose rather than by omission.
  .policy('public')
  .handler(async () => {
    // No PKCE: GitHub's OAuth 2.0 endpoint ignores it (RFC 7636 is not implemented),
    // so `state` is the whole CSRF defence and it must survive the round-trip.
    const tx = {
      state: generateOAuthState(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    }
    const headers = new Headers()
    saveTransaction(headers, tx) // your cookie
    headers.set('location', (await provider.createAuthorizationURL(tx)).href)
    return new Response(null, { status: 302, headers })
  })
  .build()
```

<!-- doc-example: needs="../../../auth/index.js" -->

```ts
// server/routes/auth/github/callback.ts
import { route } from 'theokit/server'
import { provider, sessions, loadTransaction } from '../../../auth/index.js'

export const GET = route()
  // Public because the visitor arrives WITHOUT a session — starting or finishing a
  // sign-in is what gives them one. Writing it is a decision, not a formality: it is
  // what tells a reader this route is open on purpose rather than by omission.
  .policy('public')
  .handler(async ({ request }) => {
    const { profile } = await provider.handleCallback(request, loadTransaction(request))
    const headers = new Headers()
    await sessions.createSession(headers, {
      userId: String(profile.id),
      email: profile.email,
    })
    headers.set('location', '/')
    return new Response(null, { status: 302, headers })
  })
  .build()
```

`handleCallback` accepts the Web `Request` a TheoKit route hands you as well as Node's
`IncomingMessage`, and `sessions` is a `createSessionManagerWeb(...)` from
`theokit/server/auth` — it writes the session cookie into a `Headers` you own, so the whole
flow stays on Web shapes. `Auth.create`'s orchestrator is the other way in and is
Node-shaped, so it needs a Node server rather than a route.

## Required in production: `THEOKIT_OAUTH_TX_SECRET`

**Set this, or the OAuth transaction cookie is encrypted with a constant published inside
`@theokit/sdk`.**

That cookie carries `state` and `pkceVerifier` — the two values that make an authorization-code flow
safe against CSRF and against an intercepted code. Measured 2026-08-24 in `@theokit/sdk@2.18.0`, its
encryption key is resolved as:

1. `opts.session.secret` — **unreachable**: `DefineAuthOptions.session` is typed
   `SessionManager<TSession>`, which declares four methods and no `secret`.
2. `process.env.THEOKIT_OAUTH_TX_SECRET`
3. a literal that ships in the package.

So without the environment variable, step 3 is what you get. The length guard does not help: the
constant is 48 characters, and the check is on length rather than provenance.

```bash
# 32 random bytes, base64url. Rotate it like any other signing key.
export THEOKIT_OAUTH_TX_SECRET="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')"
```

This package cannot fix it: it implements a type contract and never constructs the orchestrator, so
there is no seam here to guard. The defect is tracked against `@theokit/sdk` and pinned by
`integration/tests/seam/sdk-tx-cookie-defects.offline.test.ts`, which goes red when it is fixed.

**Related, and worth knowing:** in that same version the transaction cookie is written as
`theo_oauth_tx` while its store reads `__Host-theo_oauth_tx`. The missing prefix drops the
`__Host-` guarantee — a sibling subdomain can set the cookie — and it is also why the callback
currently cannot complete. Fixing the name makes the secret defect reachable, so the two want fixing
in that order.

## GitHub OAuth App setup

1. Open [GitHub Settings → Developer settings → OAuth Apps → New OAuth App](https://github.com/settings/developers).
2. Authorization callback URL: `https://<your-domain>/api/auth/github/callback`.
3. Copy the Client ID + generate a Client Secret. Save to `.env`:
   ```
   GITHUB_CLIENT_ID=Iv1...
   GITHUB_CLIENT_SECRET=ghsec_...
   ```
4. Default scopes: `read:user user:email` (override via `opts.scopes`).

### GitHub Enterprise Server

Override the four endpoints:

<!-- doc-example: continues partial -->

```ts
github({
  clientId: '...',
  clientSecret: '...',
  redirectUri: '...',
  authorizationEndpoint: 'https://github.acme.com/login/oauth/authorize',
  tokenEndpoint: 'https://github.acme.com/login/oauth/access_token',
  userinfoEndpoint: 'https://github.acme.com/api/v3/user',
  userEmailsEndpoint: 'https://github.acme.com/api/v3/user/emails',
})
```

## Profile shape

```ts
interface GitHubProfile {
  id: number // numeric, preserved as number (NOT string) per ADR D9
  login: string
  name?: string | null
  email?: string | null // null when scope omits user:email AND user has no public email
  avatar_url?: string
}
```

Per plan v1.1 EC-8 (SHOULD TEST): when scope omits `user:email`, `email` may be `null` even for active users. Handle that in your `onSignIn` callback — do not assume `email` is always present.

## Email resolution

When `scopes` include `user:email`:

1. Fetch `/user` first. If `email` is non-null, use it.
2. Otherwise fetch `/user/emails` and pick the primary verified address. Fall back to first verified.
3. If both fail, `email` is `null`.

When `scopes` omits `user:email`, the second fetch is skipped entirely.

## Troubleshooting

| Error code                     | Meaning                                  | Likely cause                                                 |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| `state_mismatch`               | Callback state doesn't match transaction | CSRF attempt OR stale callback. Restart sign-in              |
| `token_exchange_failed`        | GitHub rejected the code exchange        | Wrong `clientSecret`, expired code, mismatched `redirectUri` |
| `userinfo_fetch_failed`        | `/user` returned non-OK                  | Most often a 403 rate limit — check `X-RateLimit-Remaining`  |
| `missing_id` / `missing_login` | Userinfo response malformed              | GitHub API contract violation; check service status          |

## License

MIT — see [LICENSE](./LICENSE).
