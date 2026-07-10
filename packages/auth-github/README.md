# @theokit/auth-github

GitHub OAuth 2.0 provider for [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) auth orchestrator (`defineAuth`).

OAuth 2.0 only (GitHub does not expose OIDC discovery and does not implement PKCE). Hardcoded GitHub endpoints; overridable for GitHub Enterprise Server.

## Install

```bash
pnpm add @theokit/auth-github @theokit/sdk theokit
```

Peer dependencies: `@theokit/sdk >= 1.5.0`, `theokit >= 0.2.4`.

## Usage

```ts
// server/auth/index.ts
import { defineAuth } from '@theokit/sdk/server/auth'
import { github } from '@theokit/auth-github'
import { sessionManager } from './session.js'

export const auth = defineAuth({
  session: sessionManager,
  providers: [
    github({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      redirectUri: 'https://myapp.com/api/auth/github/callback',
    }),
  ],
  onSignIn: async ({ profile }) => {
    return { userId: String(profile.id), email: profile.email, login: profile.login }
  },
})
```

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
