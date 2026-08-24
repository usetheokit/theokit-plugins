# @theokit/auth-google

Google OAuth (OIDC) provider for [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) auth orchestrator (`defineAuth`).

Composes OIDC discovery + PKCE (S256) + authorization-code flow + userinfo fetch using `theokit/server/auth` primitives. Zero runtime dependencies; ~5 KB ESM bundle.

## Install

```bash
pnpm add @theokit/auth-google @theokit/sdk theokit
```

Peer dependencies: `@theokit/sdk >= 1.5.0`, `theokit >= 0.2.4`.

## Usage

<!-- doc-example: needs="./session.js" -->

```ts
// server/auth/index.ts
import { defineAuth } from '@theokit/sdk/server/auth'
import { google, type GoogleProfile } from '@theokit/auth-google'
import { sessionManager } from './session.js'

export const auth = defineAuth({
  session: sessionManager,
  providers: [
    google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: 'https://myapp.com/api/auth/google/callback',
    }),
  ],
  onSignIn: async ({ profile }) => {
    // `onSignIn` is typed `<TProfile>(args: { profile: TProfile; … })` — TProfile is unbound, so
    // the callback cannot annotate it and the cast is what a consumer actually writes.
    const p = profile as GoogleProfile // { sub, email, email_verified, name?, picture?, locale? }
    return { userId: p.sub, email: p.email }
  },
})
```

Wire into your routes:

> **Two ways in, and they differ by request shape.** `defineAuth`'s orchestrator
> (`startSignIn` / `finishSignIn`) takes Node's `IncomingMessage` / `ServerResponse`, so it
> needs a Node server. The provider itself also accepts a Web `Request`, which is what
> TheoKit's `route()` handler hands you — so inside TheoKit you drive the provider directly
> and own the session, as below.

<!-- doc-example: needs="../../../auth/index.js" -->

```ts
// server/routes/api/auth/google/start.ts
import { generateOAuthState, generatePkceChallenge } from 'theokit/server/auth'
import { route } from 'theokit/server'
import { provider, saveTransaction } from '../../../auth/index.js'

export const GET = route()
  .handler(async () => {
    const pkce = await generatePkceChallenge()
    const tx = {
      state: generateOAuthState(),
      pkceVerifier: pkce.codeVerifier,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    }
    const headers = new Headers()
    saveTransaction(headers, tx) // your cookie; it must survive the round-trip
    headers.set('location', (await provider.createAuthorizationURL(tx)).href)
    return new Response(null, { status: 302, headers })
  })
  .build()
```

<!-- doc-example: needs="../../../auth/index.js" -->

```ts
// server/routes/api/auth/google/callback.ts
import { route } from 'theokit/server'
import { provider, sessions, loadTransaction } from '../../../auth/index.js'

export const GET = route()
  .handler(async ({ request }) => {
    const { profile } = await provider.handleCallback(request, loadTransaction(request))
    const headers = new Headers()
    await sessions.createSession(headers, { userId: profile.sub, email: profile.email })
    headers.set('location', '/')
    return new Response(null, { status: 302, headers })
  })
  .build()
```

`sessions` is a `createSessionManagerWeb(...)` from `theokit/server/auth` — it writes the
session cookie into a `Headers` you own, which is what lets the whole flow stay on the Web
shapes TheoKit gives you. The transaction (state + PKCE verifier) is yours to carry across
the redirect; `handleCallback` rejects a callback whose `state` does not match it.

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

## Google Cloud Console setup

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create OAuth 2.0 Client ID:
   - Application type: **Web application**
   - Authorized redirect URI: `https://<your-domain>/api/auth/google/callback` (and `http://localhost:3000/api/auth/google/callback` for local dev)
3. Copy the Client ID + Client Secret into `.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```
4. Required scopes are added automatically: `openid`, `profile`, `email`.

## Profile shape

```ts
interface GoogleProfile {
  sub: string // OIDC subject — case-sensitive, never lowercased
  email: string
  email_verified: boolean
  name?: string
  picture?: string
  locale?: string
}
```

Per plan ADR D9 (Wasp incident lesson): `sub` is the canonical Google user identifier and is preserved verbatim. **Never lowercase, normalize, or trim it.** Different `sub` casings refer to different Google accounts.

Per plan v1.1 EC-13 (Accepted Risk): the `email_verified` boolean comes directly from Google's userinfo response. Consumers MUST decide whether to gate user creation on `email_verified === true`. The provider does not enforce this — it surfaces the field for application-level policy.

## Custom scopes (advanced)

The `google()` factory ships with `openid profile email`. If you need additional scopes (Drive, Gmail, Calendar, etc.), wrap the provider and post-process the URL:

```ts
import type { OAuthTransaction } from '@theokit/sdk/server/auth'

import { google as baseGoogle, type GoogleProviderOptions } from '@theokit/auth-google'

function googleWithDriveScope(opts: GoogleProviderOptions) {
  const base = baseGoogle(opts)
  return {
    ...base,
    async createAuthorizationURL(tx: OAuthTransaction) {
      const url = await base.createAuthorizationURL(tx)
      url.searchParams.set(
        'scope',
        'openid profile email https://www.googleapis.com/auth/drive.readonly',
      )
      return url
    },
  }
}
```

Custom scopes will land first-class via `opts.scopes` in a future minor release once demand is observed.

## Testing

For end-to-end tests that need to exercise the OIDC flow without hitting real Google, set:

```bash
NODE_ENV=test
MOCK_GOOGLE_OIDC_BASE_URL=http://localhost:9999
```

The provider will route OIDC discovery to the local sidecar instead of `accounts.google.com`. Production builds (`NODE_ENV !== 'test'`) **ignore** this env var — it is a test-only escape hatch (security pattern mirrors `THEOKIT_TEST_RESPONSE_OVERRIDE`).

## Troubleshooting

| Error code                      | Meaning                                          | Likely cause                                                                                   |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `missing_pkce_verifier`         | `OAuthTransaction.pkceVerifier` missing          | The orchestrator should populate it; check `defineAuth` wiring                                 |
| `state_mismatch`                | Callback `state` doesn't match transaction state | Either CSRF attempt OR user resubmitted a stale callback. Restart sign-in                      |
| `token_exchange_failed`         | Google rejected the code exchange                | Wrong `clientSecret`, expired code, mismatched `redirectUri`                                   |
| `missing_sub` / `missing_email` | Userinfo response lacks required fields          | OAuth scopes didn't grant `email` permission; double-check Google Cloud Console consent screen |
| OIDC discovery `403` / `404`    | `oidcBaseUrl` wrong                              | If overriding, ensure the URL serves `/.well-known/openid-configuration`                       |

## License

MIT — see [LICENSE](./LICENSE).
