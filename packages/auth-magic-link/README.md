# @theokit/auth-magic-link

Email magic-link (passwordless) provider for [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) auth orchestrator (`defineAuth`).

Pluggable token storage (`MagicLinkStore` — in-memory for dev, ORM-backed for production) + consumer-supplied email transport callback (any provider).

## Install

```bash
pnpm add @theokit/auth-magic-link @theokit/sdk theokit
```

Peer dependencies: `@theokit/sdk >= 1.5.0`, `theokit >= 0.2.4`. Zero runtime dependencies.

## Quick start (dev)

```ts
// server/auth/index.ts
import { defineAuth } from '@theokit/sdk/server/auth'
import { magicLink, createMemoryStore } from '@theokit/auth-magic-link'
import { sessionManager } from './session.js'

export const auth = defineAuth({
  session: sessionManager,
  providers: [
    magicLink({
      store: createMemoryStore(), // dev only — see "Production" below
      callbackBaseUrl: 'https://myapp.com',
      sendEmail: async ({ to, magicLinkUrl, expiresAt }) => {
        console.log(`Magic link for ${to}: ${magicLinkUrl} (expires ${expiresAt.toISOString()})`)
      },
    }),
  ],
  onSignIn: async ({ profile }) => ({ userId: profile.email, email: profile.email }),
})
```

## Wiring

Magic-link does NOT use the OAuth `startSignIn` flow — call `provider.startSignIn(req)` directly:

```ts
// server/routes/api/auth/magic-link/start.ts
import { defineRoute } from 'theokit/server'
import { magicLinkProvider } from '../../../auth/providers.js' // your magicLink() instance

export const POST = defineRoute({
  handler: async ({ req }) => {
    const redirect = await magicLinkProvider.startSignIn(req)
    return Response.redirect(redirect, 303)
  },
})

// server/routes/api/auth/magic-link/callback.ts
import { defineRoute } from 'theokit/server'
import { auth } from '../../../auth/index.js'

export const GET = defineRoute({
  handler: async ({ req, res }) => {
    const { session, returnTo } = await auth.finishSignIn('magic-link', req, res)
    return Response.redirect(returnTo ?? '/', 302)
  },
})
```

The default `resolveEmail` reads `?email=` from the URL OR the `email` field from a JSON / form-encoded body. Override via `opts.resolveEmail` for custom shapes.

## Production stores

### `@theokit/orm` adapter

```ts
import { defineEntity, BaseEntity } from '@theokit/orm'
import { createOrmStore } from '@theokit/auth-magic-link'

class MagicLinkRow extends BaseEntity {
  static __entity__ = defineEntity({
    name: 'magic_link_tokens',
    columns: {
      token: { type: 'string', primary: true, length: 64 },
      email: { type: 'string', length: 320, index: true },
      expiresAt: { type: 'datetime', index: true },
      consumedAt: { type: 'datetime', nullable: true },
    },
  })
}

const repo = orm.getRepository(MagicLinkRow)

const store = createOrmStore({
  async insert(row) {
    await repo.create(row)
  },
  async consumeAtomically(token, now) {
    // Postgres UPDATE...RETURNING + WHERE consumed_at IS NULL guarantees single-use
    const rows = await repo.query(
      `UPDATE magic_link_tokens SET consumed_at = $2 WHERE token = $1 AND consumed_at IS NULL RETURNING email, expires_at`,
      [token, now],
    )
    return rows[0] ?? null
  },
  async delete(token) {
    await repo.deleteOne({ token })
  },
  async deleteExpired(now) {
    return repo.deleteWhere(`expires_at <= $1`, [now])
  },
})
```

### Custom store

Implement the `MagicLinkStore` interface and pass it in. The contract requires atomic single-use semantics for `consumeToken` — under concurrent reads of the same token, exactly one call wins and the rest return `null`. The in-memory adapter satisfies this via the JS event loop; SQL adapters use row-level locking.

## Email transports

The `sendEmail` callback is intentionally unopinionated. Examples for popular transports:

### Resend

```ts
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

sendEmail: async ({ to, magicLinkUrl, expiresAt }) => {
  const { error } = await resend.emails.send({
    from: 'auth@myapp.com',
    to,
    subject: 'Your sign-in link',
    html: `<p>Click to sign in (expires ${expiresAt.toUTCString()}): <a href="${magicLinkUrl}">${magicLinkUrl}</a></p>`,
  })
  if (error) throw new Error(`Resend failed: ${error.message}`)
}
```

### SendGrid

```ts
import sgMail from '@sendgrid/mail'

sgMail.setApiKey(process.env.SENDGRID_API_KEY!)

sendEmail: async ({ to, magicLinkUrl, expiresAt }) => {
  await sgMail.send({
    from: 'auth@myapp.com',
    to,
    subject: 'Your sign-in link',
    html: `<p>Click to sign in (expires ${expiresAt.toUTCString()}): <a href="${magicLinkUrl}">${magicLinkUrl}</a></p>`,
  })
}
```

### Nodemailer (SMTP)

```ts
import nodemailer from 'nodemailer'

const transport = nodemailer.createTransport({
  /* SMTP config */
})

sendEmail: async ({ to, magicLinkUrl, expiresAt }) => {
  await transport.sendMail({
    from: 'auth@myapp.com',
    to,
    subject: 'Your sign-in link',
    html: `<p>Click to sign in (expires ${expiresAt.toUTCString()}): <a href="${magicLinkUrl}">${magicLinkUrl}</a></p>`,
  })
}
```

## Profile shape

```ts
interface MagicLinkProfile {
  email: string // verified by token possession
  verifiedAt: Date // when handleCallback completed
}
```

Per plan v1.1 EC-12 (SHOULD TEST absorbed): email is validated at the start-sign-in boundary (regex + non-empty). Malformed emails throw `MagicLinkConfigError(code: 'invalid_email')` BEFORE any token is created or stored.

## Token lifecycle

- 32 bytes from `crypto.randomBytes` → 43 base64url characters
- Default lifetime: 15 minutes (`opts.tokenLifetimeMs`)
- Single-use: `handleCallback` consumes atomically; second call with the same token throws `invalid_or_expired_token`
- Expired tokens reject at consume time AND can be batch-deleted via `store.cleanupExpired()` (run periodically as a cron)

## Troubleshooting

| Error                  | Code                       | Likely cause                                                                                  |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| `MagicLinkConfigError` | `invalid_email`            | Empty / malformed email field in start-sign-in request                                        |
| `MagicLinkAuthError`   | `missing_token`            | Callback URL lacks `?token=`                                                                  |
| `MagicLinkAuthError`   | `invalid_or_expired_token` | Token unknown, expired (>15min), or already consumed                                          |
| `MagicLinkConfigError` | `use_start_sign_in`        | App accidentally called `provider.createAuthorizationURL` (magic-link doesn't use OAuth flow) |

## License

MIT — see [LICENSE](./LICENSE).
