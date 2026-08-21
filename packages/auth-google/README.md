# @theokit/auth-google

Google OAuth (OIDC) provider for [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) auth orchestrator (`defineAuth`).

Composes OIDC discovery + PKCE (S256) + authorization-code flow + userinfo fetch using `theokit/server/auth` primitives. Zero runtime dependencies; ~5 KB ESM bundle.

## Install

```bash
pnpm add @theokit/auth-google @theokit/sdk theokit
```

Peer dependencies: `@theokit/sdk >= 1.5.0`, `theokit >= 0.2.4`.

## Usage

```ts
// server/auth/index.ts
import { defineAuth } from '@theokit/sdk/server/auth'
import { google } from '@theokit/auth-google'
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
    // profile is GoogleProfile { sub, email, email_verified, name?, picture?, locale? }
    return { userId: profile.sub, email: profile.email }
  },
})
```

Wire into your routes:

> **The HTTP wiring is yours, and it needs Node's `req`/`res`.** `startSignIn` and
> `finishSignIn` take `IncomingMessage` / `ServerResponse` — the OAuth state cookie is
> written straight onto the response. TheoKit's `route()` handler hands you a Web
> `Request` and no response object, so the two do not compose today and the compiler
> says so (`Request is not assignable to IncomingMessage`). Mount these on a Node
> server you control until that gap closes — tracked in
> [#68](https://github.com/usetheokit/theokit-plugins/issues/68).

```ts
// server/http.ts
import { createServer } from 'node:http'
import { auth } from './auth/index.js'

export const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/auth/google/start')) {
    const redirect = await auth.startSignIn('google', req)
    res.writeHead(302, { location: redirect.headers.get('location') ?? '/' }).end()
    return
  }
  if (req.url?.startsWith('/api/auth/google/callback')) {
    const { returnTo } = await auth.finishSignIn('google', req, res)
    res.writeHead(302, { location: returnTo ?? '/' }).end()
    return
  }
  res.writeHead(404).end()
})
```

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
import { google as baseGoogle } from '@theokit/auth-google'

function googleWithDriveScope(opts) {
  const base = baseGoogle(opts)
  return {
    ...base,
    async createAuthorizationURL(tx) {
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
