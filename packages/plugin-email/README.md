# @theokit/plugin-email

Email plugin for TheoKit — `EmailProvider` interface + Resend default + React Email opt-in peer + canonical magic-link template helper.

> **Status:** v0.1.0 initial publish on the `@next` tag. Promote to `@latest` calendar-gated alongside the Onda 2 cohort.

## What you get

- `EmailProvider` interface — implement once, use any transport.
- `ResendProvider({apiKey})` — canonical Resend SDK wrapper.
- `defineEmailProvider(impl)` — consumer extension surface for SMTP/SES/SendGrid/custom.
- `defineEmailTemplate(name, render)` — typed template factory.
- `renderReactEmail(component)` — optional React Email render bridge (dynamic peer import; zero cost when unused).
- `sendMagicLink(provider, opts)` — returns a `SendMagicLinkFn`-compatible function for wiring with `@theokit/auth-magic-link`.
- Default plain-HTML/text magic-link templates (no React Email required).
- Idempotency: `EmailMessage.idempotencyKey` → the SDK's request options, which set the `Idempotency-Key` HTTP header.

## Install

```bash
# Minimum (Resend only — no React Email):
pnpm add @theokit/plugin-email@next resend

# With React Email templates (opt-in):
pnpm add @theokit/plugin-email@next resend @react-email/render @react-email/components react

# With magic-link wiring (G11):
pnpm add @theokit/plugin-email@next resend @theokit/auth-magic-link@next
```

## Wire it into your app

<!-- doc-example: partial -->

```ts
import { ResendProvider, sendMagicLink } from '@theokit/plugin-email'
import { magicLink } from '@theokit/auth-magic-link'

const email = ResendProvider({ apiKey: process.env.RESEND_API_KEY })

// Use directly:
await email.send({
  from: 'Acme <noreply@app.test>',
  to: 'user@example.com',
  subject: 'Welcome',
  html: '<h1>Welcome!</h1>',
  text: 'Welcome!',
})

// Wire magic-link:
const magicLinkProvider = magicLink({
  store: yourTokenStore,
  callbackBaseUrl: 'https://app.test',
  sendEmail: sendMagicLink(email, {
    from: 'Acme <noreply@app.test>',
    appName: 'Acme',
  }),
})
```

## EmailProvider contract

```ts
interface EmailMessage {
  to: string | readonly string[]
  from: string
  subject: string
  html: string
  text?: string
  cc?: string | readonly string[]
  bcc?: string | readonly string[]
  replyTo?: string
  idempotencyKey?: string
  headers?: Record<string, string>
}

interface SendResult {
  id: string // Provider-assigned message ID
  provider: string // e.g., "resend"
  raw?: unknown // Provider response for diagnostics
}

interface EmailProvider {
  name: string
  send(message: EmailMessage): Promise<SendResult>
}
```

## Custom providers

```ts
import { defineEmailProvider, type EmailMessage, type SendResult } from '@theokit/plugin-email'

const consoleProvider = defineEmailProvider({
  name: 'console',
  async send(msg: EmailMessage): Promise<SendResult> {
    console.log('[email]', msg.subject, '→', msg.to)
    return { id: `console_${Date.now()}`, provider: 'console' }
  },
})
```

## Templates

### Plain HTML/text templates (no React Email required)

<!-- doc-example: partial -->

```ts
import { defineEmailTemplate } from '@theokit/plugin-email'

export const welcomeTemplate = defineEmailTemplate<{ name: string }>('welcome', async (props) => ({
  subject: `Welcome, ${props.name}`,
  html: `<h1>Hi ${props.name}</h1>`,
  text: `Hi ${props.name}`,
}))

// Invoke:
const { subject, html, text } = await welcomeTemplate.render({ name: 'Ana' })
await email.send({ from: 'noreply@app.test', to: 'ana@example.com', subject, html, text })
```

### React Email templates (opt-in)

Install peers first: `pnpm add @react-email/render @react-email/components react`.

<!-- doc-example: needs="@react-email/components" needs="react/jsx-runtime" partial -->

```tsx
import { defineEmailTemplate, renderReactEmail } from '@theokit/plugin-email'
import { Html, Head, Body, Container, Heading, Button } from '@react-email/components'

const WelcomeEmail = ({ name }: { name: string }) => (
  <Html>
    <Head />
    <Body>
      <Container>
        <Heading>Welcome, {name}!</Heading>
        <Button href="https://app.test/onboard">Get started</Button>
      </Container>
    </Body>
  </Html>
)

export const welcomeTemplate = defineEmailTemplate<{ name: string }>('welcome', async (props) => ({
  subject: `Welcome, ${props.name}`,
  html: await renderReactEmail(<WelcomeEmail name={props.name} />),
}))
```

## Magic-link integration

`sendMagicLink(provider, opts)` returns a function satisfying `@theokit/auth-magic-link`'s `SendMagicLinkFn` contract:

<!-- doc-example: partial -->

```ts
import { ResendProvider, sendMagicLink } from '@theokit/plugin-email'
import { magicLink } from '@theokit/auth-magic-link'

const email = ResendProvider({ apiKey: process.env.RESEND_API_KEY })

magicLink({
  store,
  callbackBaseUrl: 'https://app.test',
  sendEmail: sendMagicLink(email, {
    from: 'Acme <noreply@app.test>',
    appName: 'Acme',
    // Customize the subject:
    subject: ({ to, appName }) => `${appName} sign-in link for ${to}`,
    // Or fully customize the HTML body:
    renderHtml: ({ magicLinkUrl, expiresAt, appName }) =>
      `<a href="${magicLinkUrl}">Sign in to ${appName}</a>`,
  }),
})
```

The default templates ship plain HTML + text bodies (no React Email required) with a clean, accessible, single-CTA layout.

## Idempotency

Resend deduplicates on the `Idempotency-Key` **HTTP request header**. Plugin-email passes
`EmailMessage.idempotencyKey` through the Resend SDK's request options, which is what
sets that header — sending the same key twice returns the same message id instead of
delivering twice:

<!-- doc-example: partial -->

```ts
await email.send({
  from: 'noreply@app.test',
  to: 'user@example.com',
  subject: 'Welcome',
  html: '<h1>Hi</h1>',
  idempotencyKey: 'user_welcome_u_123', // Stable key — same input → same key
})
```

For magic-link, the default builder derives the key from the unique token:
`magic_link:${token}`. Override via the `idempotencyKey` option, or disable with `idempotencyKey: null`.

## Threats addressed

| Threat               | Mitigation                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Replay attacks**   | Idempotency-Key header dedup via Resend (server-side)                              |
| **Secret leakage**   | `RESEND_API_KEY` resolved from env vars; plugin never logs                         |
| **XSS in templates** | Default magic-link template escapes user-controlled `appName`                      |
| **Error swallowing** | `EmailSendError` typed errors propagate; plugin never silences                     |
| **Provider lock-in** | `EmailProvider` interface — consumers swap providers without re-writing call sites |

## License

MIT
