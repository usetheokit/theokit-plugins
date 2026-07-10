# @theokit/plugin-payments

Stripe-only payments plugin for TheoKit — typed webhook dispatcher with signature verification + idempotency + Checkout helper (hosted-page passthrough).

> **Status:** v0.1.0 initial publish on the `@next` tag. Promote to `@latest` is calendar-gated alongside the Onda 2 cohort.

## What you get

- `payments(opts)` plugin factory wired into `theo.config.ts`.
- `defineStripeWebhook(type, handler)` typed dispatcher — handler receives narrowed `Stripe.Event` variant via discriminated union on `event.type`.
- Signature verification via `stripe.webhooks.constructEvent()` + actionable error type.
- Idempotency store (memory default, swap for `createOrmStore(repo)` in prod) — prevents double-processing on Stripe retries (~3 days).
- `createCheckoutSession(client, params)` returning `{url, sessionId}` for Stripe-hosted checkout.
- Currency helpers (`formatAmountForStripe`, `formatAmountForDisplay`) — handles zero-decimal vs decimal currencies.
- Selective `Stripe` type re-export for consumer ergonomics.

Stripe SDK is a required peer. `@theokit/orm` is optional — only needed when you swap the memory store for the production-grade orm-backed implementation.

## Install

```bash
pnpm add @theokit/plugin-payments@next stripe
# Production idempotency via @theokit/orm:
pnpm add @theokit/orm@next drizzle-orm reflect-metadata
```

## Wire it into `theo.config.ts`

```ts
import { payments } from '@theokit/plugin-payments'
import { defineConfig } from 'theokit'

export default defineConfig({
  plugins: [
    payments({
      // secretKey defaults to process.env.STRIPE_SECRET_KEY
      // webhookSecret defaults to process.env.STRIPE_WEBHOOK_SECRET
      apiVersion: '2023-10-16',
    }),
  ],
})
```

## Options reference

| Option             | Type                      | Default                             | Notes                               |
| ------------------ | ------------------------- | ----------------------------------- | ----------------------------------- |
| `secretKey`        | `string`                  | `process.env.STRIPE_SECRET_KEY`     | Stripe secret key                   |
| `webhookSecret`    | `string`                  | `process.env.STRIPE_WEBHOOK_SECRET` | Webhook signing secret              |
| `apiVersion`       | `Stripe.LatestApiVersion` | `'2023-10-16'`                      | Stripe API version pin              |
| `idempotencyStore` | `IdempotencyStore`        | memory store                        | Pass `createOrmStore(repo)` in prod |

## Webhook handler example

```ts
import {
  defineStripeWebhook,
  processWebhook,
  WebhookRegistry,
  payments,
} from '@theokit/plugin-payments'

const plugin = payments()
const registry = new WebhookRegistry()

registry.register(
  defineStripeWebhook('checkout.session.completed', async (event) => {
    // event is typed as Stripe.CheckoutSessionCompletedEvent
    const session = event.data.object
    console.log('Customer:', session.customer)
    // ...persist to your DB via @theokit/orm Repository
  }),
)

// In your theokit route handler (await req.text() FIRST — before any other body access):
export async function POST(req: Request) {
  const rawBody = await req.text()
  const result = await processWebhook({
    stripe: plugin.getStripeClient(),
    rawBody,
    signatureHeader: req.headers.get('stripe-signature') ?? undefined,
    webhookSecret: plugin.options.webhookSecret!,
    registry,
    store: plugin.options.idempotencyStore!,
  })

  switch (result.status) {
    case 'ok':
      return Response.json({ received: true, eventId: result.eventId })
    case 'signature_invalid':
      return Response.json({ error: result.message }, { status: 400 })
    case 'handler_error':
      // Stripe retries on 5xx — choose carefully
      return Response.json({ error: 'handler failed' }, { status: 500 })
  }
}
```

## Checkout session example

```ts
import { createCheckoutSession, payments, formatAmountForStripe } from '@theokit/plugin-payments'

const plugin = payments()

// In your server action:
export async function startCheckout() {
  const { url, sessionId } = await createCheckoutSession(plugin.getStripeClient(), {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'USD',
          product_data: { name: 'Pro Plan' },
          unit_amount: formatAmountForStripe(29.99, 'USD'), // → 2999 cents
        },
      },
    ],
    success_url: 'https://app.test/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://app.test/cancel',
    customer_email: 'user@example.com',
    metadata: { userId: 'u_123' }, // tie to your auth session
  })

  return { redirectTo: url, sessionId }
}
```

## Idempotency in production

The memory store ships as default but is **not multi-replica safe**. For production, swap it for the orm-backed store:

```ts
import { createOrmStore, payments } from '@theokit/plugin-payments'
import { OrmModule, Repository } from '@theokit/orm'

// Schema (drizzle):
// CREATE TABLE webhook_events (
//   event_id TEXT PRIMARY KEY,
//   processed_at TIMESTAMP NOT NULL DEFAULT NOW()
// );

const repo = {
  async insertNew(eventId: string): Promise<boolean> {
    try {
      await db.insert(webhookEvents).values({ eventId })
      return true
    } catch (err) {
      // UNIQUE constraint violation → already processed
      if (err.code === '23505') return false
      throw err
    }
  },
  // Release the claim when the handler failed, so Stripe's retry re-runs it.
  async delete(eventId: string): Promise<void> {
    await db.delete(webhookEvents).where(eq(webhookEvents.eventId, eventId))
  },
}

const plugin = payments({ idempotencyStore: createOrmStore(repo) })
```

## Security threats addressed

| Threat                | Mitigation                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------ |
| **Replay attacks**    | Idempotency store rejects duplicate `event.id` via atomic UNIQUE constraint                |
| **Signature forgery** | `stripe.webhooks.constructEvent()` validates HMAC-SHA256 against webhook secret            |
| **Body tampering**    | Signature verification consumes raw body BEFORE JSON parsing — see "Raw body access" below |
| **Secret leakage**    | `secretKey` + `webhookSecret` resolved from env vars; plugin never logs them               |
| **Double-processing** | Idempotency table guarantees each `event.id` runs exactly once                             |

### Raw body access (critical)

Webhook routes MUST receive raw bytes BEFORE any other body access. JSON parsing before signature verification breaks the HMAC.

- **theokit / standard fetch handlers**: `await req.text()` — no special config.
- **Vercel app router**: works by default with `req.text()`.
- **Vercel pages router**: add `export const config = { api: { bodyParser: false } }` to the webhook route.
- **Cloudflare Workers**: `await request.text()` — same.

## Canonical subscription events to handle

When wiring subscription support, register handlers for these 7 events (no built-in state machine — your data model owns it):

| Event                                  | When it fires                             |
| -------------------------------------- | ----------------------------------------- |
| `customer.subscription.created`        | New subscription activated                |
| `customer.subscription.updated`        | Plan change, quantity update, etc.        |
| `customer.subscription.deleted`        | Subscription cancelled                    |
| `customer.subscription.trial_will_end` | 3-day trial-ending notification           |
| `invoice.payment_succeeded`            | Successful charge → grant access          |
| `invoice.payment_failed`               | Failed charge → revoke access / dunning   |
| `checkout.session.completed`           | Initial purchase → bootstrap subscription |

## Auth integration (G11)

Tie Stripe customers to your authenticated users via `metadata`:

```ts
await createCheckoutSession(client, {
  // ...
  customer_email: session.user.email,
  metadata: { userId: session.user.id },
})
```

In the webhook handler, read `event.data.object.metadata.userId` to correlate back. Plugin does NOT auto-correlate to avoid coupling to specific auth strategies.

## License

MIT
