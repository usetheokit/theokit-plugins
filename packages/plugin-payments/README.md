# @theokit/plugin-payments

Multi-provider payments for TheoKit. One neutral contract, with Stripe and AbacatePay (PIX) behind subpath exports.

> **Status:** v0.3.0. The 0.2.x surface was Stripe-only and lived on the top-level import; every Stripe export moved to `@theokit/plugin-payments/stripe`. See [Migrating from 0.2.x](#migrating-from-02x).

## What you get

**Neutral — `@theokit/plugin-payments`**

`PaymentProvider`, the four things every gateway here does:

| Method                        | What it is for                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createCheckout(input)`       | A checkout — one-off or `mode: 'subscription'`, hosted or embedded. The result is discriminated by `uiMode`: hosted carries `url`, embedded carries `clientSecret`. |
| `verifyWebhook(req)`          | Authenticity + normalisation. Throws on a bad signature.                                                                                                            |
| `retrieveCheckout(reference)` | Where a charge stands, **asked** rather than waited for.                                                                                                            |
| `refund(input)`               | Refund a completed charge in full.                                                                                                                                  |

Plus:

- `payments({ providers })` — the plugin for `theo.config.ts`. Holds the gateways, one idempotency store and one registry, so a webhook route is `plugin.handleWebhook(gateway, request)`.
- `processPaymentWebhook({ provider, request, registry, store })` — the same thing unwrapped, for apps that assemble the pieces themselves.
- `PaymentEventRegistry` + `definePaymentWebhook(type, handler)` — routing on the normalised event set.
- `definePaymentProvider(impl)` — validates a provider at wiring time, so a malformed one fails at boot rather than mid-checkout.
- Three capability guards for what only some gateways do: `supportsPix`, `supportsPartialRefund`, `supportsSubscriptions`.
- Idempotency store (memory default, `createOrmStore(repo)` for production) and currency helpers.

### Why `retrieveCheckout` is in the base contract

Webhook delivery is at-least-once, and at-least-once is not at-least-one. A
dropped delivery, a deploy inside the retry window, or an endpoint that 500s
past the provider's give-up point all end the same way: a paid customer and an
order nobody fulfilled. Reconciliation needs a way to **ask**, and a payments
contract without one obliges every consumer to reach around it to the gateway
SDK — which is the coupling this package exists to remove.

**Stripe — `@theokit/plugin-payments/stripe`**

- `StripeProvider({ client, webhookSecret })` — Stripe as a `PaymentProvider`.
- `stripePayments(opts)` — single-gateway plugin factory that resolves its keys from the environment. The multi-provider `payments()` lives on the top-level import.
- `defineStripeWebhook(type, handler)` — the fully-typed Stripe event union, narrowed via `Extract<Stripe.Event, { type: T }>`. Code that branches on `payment_intent.processing` needs Stripe's own types, and normalising them away would be a downgrade, not an abstraction.
- `createCheckoutSession(client, params)`, `verifyAndParseWebhook`, `processWebhook`, `Stripe` type re-export.

**AbacatePay — `@theokit/plugin-payments/abacatepay`**

- `AbacatePayProvider({ apiKey, webhookSecret })` — hosted checkout plus inline PIX via `createPixCharge`. Embedded checkout is **not implemented by this adapter**; whether AbacatePay offers one is unverified — see below.
- No SDK and no peer dependency: it speaks REST over `fetch`.

### Why subpaths

A Brazilian shop taking only PIX should not carry Stripe's SDK types in its build. Neither peer dependency is required unless the matching subpath is imported — `dist/abacatepay.js` imports `node:crypto` and nothing else.

### Capabilities: what only some gateways do

`PaymentProvider` holds what both do. Anything else is a capability behind a
guard, so the **compiler** stops a call the provider cannot serve:

| Guard                   | Method               | Stripe | AbacatePay                          |
| ----------------------- | -------------------- | ------ | ----------------------------------- |
| `supportsPix`           | `createPixCharge`    | ✗      | ✓                                   |
| `supportsPartialRefund` | `refundPartial`      | ✓      | ✗ — refunds integrally, and says so |
| `supportsSubscriptions` | `cancelSubscription` | ✓      | ✓                                   |

<!-- doc-example: partial -->

```ts
import { supportsPix, supportsPartialRefund } from '@theokit/plugin-payments'

if (supportsPix(provider)) {
  const { brCode, brCodeBase64 } = await provider.createPixCharge({ amountInCents: 10_000 })
}
if (supportsPartialRefund(provider)) {
  await provider.refundPartial({ reference: id, amountInCents: 400 })
}
```

Giving the base contract a `createPixCharge` would force Stripe to throw from
it, and a type describing a capability half its implementations lack teaches the
reader nothing.

### The line between a capability and a field

`mode: 'subscription'` is a plain field on `CheckoutInput`, while cancelling a
subscription is a capability. That looks arbitrary until you see the rule:

- a **value** a provider cannot serve is validated and refused at runtime —
  AbacatePay rejects a non-BRL currency the same way;
- a **method** a provider does not have is a capability, because its absence has
  to be visible to the compiler. Otherwise every consumer writes a call that
  type-checks and throws.

## Hosted and embedded checkout

`createCheckout` serves both, discriminated by `uiMode`. Narrow on it to reach the field that mode
carries:

<!-- doc-example: needs="./my-provider.js" -->

```ts
import type { CheckoutResult } from '@theokit/plugin-payments'

import { provider } from './my-provider.js'

// Hosted — the default. Written exactly as it was before `uiMode` existed.
const hosted: CheckoutResult = await provider.createCheckout({
  items: [{ ref: 'price_123', quantity: 1 }],
  successUrl: 'https://shop.example/ok',
  cancelUrl: 'https://shop.example/cancel',
})
if (hosted.uiMode === 'hosted') {
  // redirect the customer to hosted.url
}

// Embedded — the form mounts inside your page.
const embedded: CheckoutResult = await provider.createCheckout({
  items: [{ ref: 'price_123', quantity: 1 }],
  uiMode: 'embedded',
  returnUrl: 'https://shop.example/return?s={CHECKOUT_SESSION_ID}',
})
if (embedded.uiMode === 'embedded') {
  // hand embedded.clientSecret to Stripe's client-side SDK
}
```

**`returnUrl` replaces the hosted pair — it does not join it.** Measured live: Stripe answers
`` `success_url` is not supported with `ui_mode: embedded` `` and refuses the request outright. The
input type makes the combination unrepresentable, so a wrong call fails at compile time instead of
at the gateway.

**`url` stays required on the hosted branch.** It could have become optional, and that would have
moved a compile-time guarantee into a runtime check for every caller who never uses embedded.
Narrowing keeps the promise where it was — at the cost of one `if`, which is the compile error that
replaces a runtime `undefined`.

### AbacatePay and embedded checkout

This adapter does not implement embedded checkout, and refuses such a request by name
(`embedded_not_implemented`).

**Whether AbacatePay offers one is unverified.** Nobody has asked its API: the live measurement
behind this feature was run against Stripe. Saying "AbacatePay does not support embedded checkout"
would state as fact something no measurement here supports, so it is not said.

## Install

```bash
# neutral surface only (write your own provider, or use AbacatePay)
pnpm add @theokit/plugin-payments

# + Stripe
pnpm add @theokit/plugin-payments stripe

# production idempotency via @theokit/orm
pnpm add @theokit/orm drizzle-orm reflect-metadata
```

## Multi-provider in practice

<!-- doc-example: partial -->

```ts
import {
  createMemoryStore,
  definePaymentWebhook,
  PaymentEventRegistry,
  processPaymentWebhook,
} from '@theokit/plugin-payments'
import { StripeProvider } from '@theokit/plugin-payments/stripe'
import { AbacatePayProvider } from '@theokit/plugin-payments/abacatepay'
import Stripe from 'stripe'

const providers = {
  stripe: StripeProvider({
    client: new Stripe(process.env.STRIPE_SECRET_KEY!),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  }),
  abacatepay: AbacatePayProvider({
    apiKey: process.env.ABACATEPAY_API_KEY!,
    webhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET,
  }),
}

const registry = new PaymentEventRegistry()
registry.register(
  definePaymentWebhook('checkout.completed', async (event) => {
    // `event.type` is normalised; `event.providerEventType` keeps the gateway's
    // own name, and `event.raw` the untouched payload. Nothing is discarded.
    await fulfilOrder(event.id, event.provider)
  }),
)

const store = createMemoryStore() // createOrmStore(repo) in production

// One route per gateway, one handler body.
export async function POST(req: Request, { params }: { params: { gateway: string } }) {
  const result = await processPaymentWebhook({
    provider: providers[params.gateway as keyof typeof providers],
    request: {
      rawBody: await req.text(), // MUST be read before any other body access
      headers: Object.fromEntries(req.headers),
      url: req.url, // AbacatePay's secret is in the query string
    },
    registry,
    store,
  })

  if (result.status === 'signature_invalid') return new Response('invalid', { status: 401 })
  if (result.status === 'handler_error') return new Response('retry', { status: 500 })
  return new Response('ok')
}
```

### AbacatePay: what to know before wiring it

> **Exercised against the live sandbox API.** Twelve assertions run against a
> real AbacatePay devMode account — hosted checkout, inline PIX with a payable BR
> Code, status reconciliation across both resource kinds, a full refund confirmed
> by re-reading the charge, and the typed refusals. Writing them refuted three
> things the published documentation had said; each is noted below where it
> applies. Subscriptions and inbound webhook delivery remain uncovered, for
> measured reasons — see § What is still not covered.

- **BRL only.** A `createCheckout` with any other currency is refused, not converted.
- **No idempotency mechanism is documented**, so `CheckoutInput.idempotencyKey` is ignored on this provider — deliberately, rather than mapped onto `externalId`, which AbacatePay does not deduplicate on and which would look like retry safety while providing none. Its refund endpoint is idempotent by resource id instead, so nothing is sent there either.
- **Webhook verification needs the request URL.** The per-merchant secret arrives as `?webhookSecret=…`, and verification refuses to run without it rather than falling back to no check.
- **The secret arrives in a header too, and that is undocumented.** Measured on a real delivery: AbacatePay sends the per-merchant secret as an `x-webhook-secret` **header** as well as `?webhookSecret=`. The provider prefers the header — a secret in a URL reaches proxy logs, browser history and Referer, and a query string is the part of a request people paste into tickets. Pass `headers`, or `url`, or both; it refuses when neither carries it.
- **The HMAC header is opt-in, and now for a measured reason.** Their docs contradict themselves on which key signs: the webhooks reference says your `secret`, the security page hardcodes a global constant. A real `transparent.completed` settled it — the signature matched **the published constant**, in base64, and not the merchant secret in either encoding. So it proves the body was not altered in transit and **not** that AbacatePay sent it: anyone who read the docs can produce a valid signature. Authenticity comes from the per-merchant secret, which is verified unconditionally. Pass `ABACATEPAY_DOCUMENTED_PUBLIC_KEY` to `signatureKey` when you want the integrity half too, knowing what it buys.
- **Payment methods are a provider option, and you probably need it.** Measured: omitting `methods` makes `/checkouts/create` inherit the API default and answer `"CARD is not available for this store"`, so a PIX-only store cannot create a checkout at all. AbacatePay has since narrowed the field to `(PIX)` in its own docs, with CARD commented out. Pass `AbacatePayProvider({ apiKey, methods: ['PIX'] })`.
- **Refunds route by id prefix**, and the docs say they do not. Their prefix table claims `/checkouts/refund` accepts `bill_`, `char_`, `pix_char_` and `card_`; the API answers `"Use a rota /v2/transparents/refund para reembolsar cobranças transparentes."` The routing had been removed on the strength of that table and is restored.
- **A successful refund returns `id`, not `refundPublicId`.** The documented shape is `{ refundPublicId }`; the real one is `{ id, status: "COMPLETE", amount, originalId, createdAt }`. Reading only the documented key made the provider throw `refund_failed` on every successful refund — and no unit test could see it, because the fake was written from the same docs. Both keys are accepted now.
- **Subscriptions post to `/subscriptions/create`** and accept exactly one item, whose product must carry a `cycle`. The provider enforces the single-item rule itself so the caller learns the rule, not a field name in a 400. **AbacatePay has commented the entire subscriptions section out of its documentation**, and the endpoint answers `"PIX Automático is not available for this store"` — so this path is shipped but unverifiable, and may be being withdrawn.
- **Refunds go to one endpoint, status reads go to two.** `/checkouts/refund` documents every id shape AbacatePay issues (`bill_`, `char_`, `pix_char_`, `card_`), so no prefix routing is needed and a wrong branch is impossible. Status is different: `/checkouts/get` and `/transparents/check` read different resources, and asking the wrong one is a 404.
- **`cancelSubscription` takes a `subs_…` id, not the checkout's `bill_…`.** The subscription only exists once the customer pays, and AbacatePay documents no lookup from one to the other — take the id from the `subscription.completed` webhook.
- **Status is read from `/checkouts/get`, not `/checkouts/one`.** AbacatePay's own documentation contradicts itself: the `llms.txt` index names `/checkouts/one`, the OpenAPI block on the same page names `/checkouts/get`. Measured unauthenticated on 2026-08-18, `/checkouts/get` answers `401` (exists, needs auth) while `/checkouts/one` answers `400` — identical to a route that does not exist. Following the index would have shipped a status check that fails on every call.

### What is still not covered

|                                        | Why, measured                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscriptions                          | AbacatePay commented the whole section out of its docs; `/subscriptions/create` answers "PIX Automático is not available for this store". The endpoint exists, the capability does not.                                                                                                                                                                                                                        |
| Inbound webhook delivery, continuously | Covered ONCE, through a public tunnel with a registered webhook, and the capture is now an offline regression fixture (`tests/abacatepay-real-delivery.test.ts`) that runs on every push with no credential. What is not automated is re-capturing it — that needs a tunnel binary and inbound network, so a change on their side would be caught by the fixture going stale rather than by CI noticing first. |
| `GET /store/get`                       | A documented endpoint that answers "Not found", so store capabilities cannot be read programmatically to pick `methods` for you.                                                                                                                                                                                                                                                                               |

## Migrating from 0.2.x

Nothing was removed or renamed. Every Stripe export moved one import deeper:

```diff
-import { payments, defineStripeWebhook, processWebhook } from '@theokit/plugin-payments'
+import { payments } from '@theokit/plugin-payments'
+import { defineStripeWebhook, processWebhook } from '@theokit/plugin-payments/stripe'
```

`createMemoryStore`, `createOrmStore`, `IdempotencyStore`, `formatAmountForStripe` and `formatAmountForDisplay` stay on the top-level import — idempotency and minor-unit arithmetic are not Stripe's.

## Wire it into `theo.config.ts`

```ts
import { payments } from '@theokit/plugin-payments'
import { StripeProvider } from '@theokit/plugin-payments/stripe'
import { AbacatePayProvider } from '@theokit/plugin-payments/abacatepay'
import { config } from 'theokit'
import Stripe from 'stripe'

export default config()
  .set({
    plugins: [
      payments({
        providers: {
          stripe: StripeProvider({
            client: new Stripe(process.env.STRIPE_SECRET_KEY!),
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
          }),
          abacatepay: AbacatePayProvider({
            apiKey: process.env.ABACATEPAY_API_KEY!,
            webhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET,
          }),
        },
      }),
    ],
  })
  .build()
```

The plugin holds the providers, one idempotency store and one handler registry —
which is what a webhook route needs, and nothing more. A route handler becomes
one call:

<!-- doc-example: partial -->

```ts
export async function POST(req: Request, { params }: { params: { gateway: string } }) {
  const result = await plugin.handleWebhook(params.gateway, {
    rawBody: await req.text(), // MUST be read before any other body access
    headers: Object.fromEntries(req.headers),
    url: req.url,
  })
  if (result.status === 'signature_invalid') return new Response('invalid', { status: 401 })
  if (result.status === 'handler_error') return new Response('retry', { status: 500 })
  return new Response('ok')
}
```

**Providers are keyed by the name your app routes them under, not by
`provider.name`.** Two Stripe accounts is a real shape — a marketplace, or
separate legal entities — and deriving the key from the provider would collapse
them into one.

### `ctx.payments` — what `register()` actually does

The plugin publishes its gateways on the request context, so a handler reaches
them without importing and wiring the plugin a second time:

<!-- doc-example: partial -->

```ts
export const POST = route().handler(async ({ ctx, request, params }) => {
  const result = await ctx.payments.handleWebhook(params.gateway, {
    rawBody: await request.text(),
    headers: Object.fromEntries(request.headers),
    url: request.url,
  })
  // … your own handling …
})
```

`ctx.payments` is deliberately narrower than the plugin: `providers`,
`provider(key)` and `handleWebhook`, and **not** `store` or `registry`. That
narrowing buys a safety property rather than tidiness — a handler holding
`store` could claim or release an event id outside the dispatcher and defeat
idempotency; one holding `registry` could rewire routing mid-request.

**No route is registered for you, and that is not a choice we made.** A TheoKit
plugin _cannot_ register one: `TheoApp` gives `register()` exactly `addHook` and
`decorateRequest`. Routes come from the `route()` builder in your own route
files. Earlier versions of this README described the absence as a design
decision; it is a platform constraint, and saying otherwise was writing prose
without reading the contract (#42).

**No hook is registered either, and that one IS a choice.** A payments plugin
adding an `onRequest` hook would run on every request in the app, including the
ones that never touch money.

### Single-gateway Stripe, with its own event types

`stripePayments()` on the `/stripe` subpath is the other factory. It resolves
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` from the environment and gives you
`getStripeClient()`, and it pairs with `defineStripeWebhook` — which narrows
`Stripe.Event` in a way the neutral contract cannot express. Reach for it when
you take one gateway and want its own event union; reach for `payments()` when
you take more than one, or want to be able to.

<!-- doc-example: partial -->

```ts
import { stripePayments } from '@theokit/plugin-payments/stripe'

export default defineConfig({ plugins: [stripePayments({ apiVersion: '2023-10-16' })] })
```

Its `register()` publishes the client on `ctx.stripe` — the equivalent of
`@InjectStripeClient` in the NestJS ecosystem — and resolves it **at boot**, so a
missing `STRIPE_SECRET_KEY` crashes on startup instead of 500-ing while somebody
is paying.

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
  stripePayments,
} from '@theokit/plugin-payments/stripe'

const plugin = stripePayments()
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
import { formatAmountForStripe } from '@theokit/plugin-payments'
import { createCheckoutSession, stripePayments } from '@theokit/plugin-payments/stripe'

const plugin = stripePayments()

// In your server action:
export async function startCheckout() {
  const session = await createCheckoutSession(plugin.getStripeClient(), {
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

  // Narrowed: the envelope is discriminated, because an embedded session has no url at all. This
  // example asked for hosted (`success_url` is present), so this branch is the one it gets.
  if (session.uiMode !== 'hosted') {
    throw new Error('expected a hosted session')
  }
  return { redirectTo: session.url, sessionId: session.sessionId }
}
```

## Idempotency in production

The memory store ships as default but is **not multi-replica safe**. For production, swap it for the orm-backed store:

<!-- doc-example: needs="@theokit/orm" partial -->

```ts
import { createOrmStore } from '@theokit/plugin-payments'
import { stripePayments } from '@theokit/plugin-payments/stripe'
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

const plugin = stripePayments({ idempotencyStore: createOrmStore(repo) })
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

<!-- doc-example: partial -->

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
