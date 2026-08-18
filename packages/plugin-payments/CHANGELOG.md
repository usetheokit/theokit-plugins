# @theokit/plugin-payments

## 0.3.0

### Minor Changes

- 74b7c71: Multi-provider: Stripe and AbacatePay behind one neutral contract. **Breaking.**

  The package was Stripe-shaped all the way down — `payments()` returned a `getStripeClient()`, the webhook dispatcher spoke `Stripe.Event`, and the only way to take PIX in Brazil was not to use this plugin. Adding a second gateway alongside the first would have meant two parallel surfaces that share nothing.

  **What the neutral surface gives you** (`@theokit/plugin-payments`): `PaymentProvider` — `createCheckout` + `verifyWebhook` — plus `processPaymentWebhook`, which verifies, deduplicates and dispatches for any provider. Application code written against it switches gateways without a rewrite.

  **What stays gateway-specific**: `@theokit/plugin-payments/stripe` and `@theokit/plugin-payments/abacatepay`. Subpaths, not one bundle: a Brazilian shop taking only PIX gets no Stripe SDK types in its build, and neither peer dependency is needed unless the matching subpath is imported.

  **PIX is a typed optional capability, not a lowest common denominator.** AbacatePay serves an inline QR payload; Stripe has no equivalent. Rather than give `PaymentProvider` a `createPixCharge` that Stripe would have to throw from, it lives on `PixCapableProvider` behind the `supportsPix` type guard — so the compiler stops the call on Stripe, and AbacatePay is not amputated to fit.

  Migration — every Stripe export moved to the `/stripe` subpath, nothing was removed or renamed:

  ```diff
  -import { payments, defineStripeWebhook, processWebhook } from '@theokit/plugin-payments'
  +import { payments, defineStripeWebhook, processWebhook } from '@theokit/plugin-payments/stripe'
  ```

  `createMemoryStore`, `createOrmStore`, `IdempotencyStore`, `formatAmountForStripe` and `formatAmountForDisplay` stay on the top-level import — idempotency and minor-unit arithmetic are not Stripe's.

  Also in this release:
  - **`verifyWebhook` now always rejects, never throws synchronously.** A missing signature header or an unconfigured secret used to escape a caller's `.catch()` and take down the request instead of returning a 400.
  - **Event ids are namespaced per provider** in the shared idempotency store. Two gateways can both emit `evt_1`; unnamespaced, the second would be swallowed as a duplicate and that payment silently never fulfilled.
  - **AbacatePay's `?webhookSecret=` is verified in constant time, and verification refuses to run without the request URL** rather than falling back to no check. Its HMAC header is opt-in via `signatureKey`, because the key its docs publish is a global constant — that proves the body was not altered, not that AbacatePay sent it.
  - **`node:` import prefixes survive the build** (`removeNodeProtocol: false`). tsup was rewriting `node:crypto` to bare `crypto`, which Deno, Bun and Workers-style runtimes do not resolve. The other packages in the repo still ship that way — tracked in usetheokit/theokit-plugins#38.

  **The contract covers the whole lifecycle, not just the start of it.** A payments plugin that can only create a checkout leaves every consumer reaching around it to the gateway SDK for the parts that actually run a business:

  | Method                        | Why it is in the base contract                                                                                                                                                                                                                                |
  | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `retrieveCheckout(reference)` | Webhook delivery is at-least-once, which is not at-least-one. A dropped delivery, a deploy inside the retry window, or an endpoint that 500s past the give-up point all end with a paid customer and an unfulfilled order. Reconciliation needs a way to ASK. |
  | `refund(input)`               | Both gateways refund in full. Partial refunds are a capability (`supportsPartialRefund`) because AbacatePay refunds integrally and documents that it does.                                                                                                    |

  `mode: 'subscription'` on `CheckoutInput` closes #39 — the contract previously hardcoded `mode: 'payment'`, so it could not begin a recurring charge on either provider. Ending one is `cancelSubscription`, behind `supportsSubscriptions`. The split follows a rule rather than a mood: a **value** a provider cannot serve is validated and refused at runtime (AbacatePay rejects non-BRL the same way), while a **method** it does not have must be visible to the compiler, or every consumer writes a call that type-checks and throws.

  **Verified against the live Stripe API, without a browser.** Thirteen assertions run nightly, including the ones a fake cannot support: the same idempotency key returning the same session; a real charge confirmed with `pm_card_visa` then refunded in full and in part; a real `active` subscription cancelled and then re-read from Stripe to confirm it stuck. The AbacatePay provider is implemented from published documentation and covered only against a fake — nobody here has an account, and the README says so where a reader will see it before wiring it.

  That distinction earned its keep immediately: AbacatePay's own docs contradict themselves on the status endpoint, and measuring settled it. `/checkouts/get` answers 401 unauthenticated (exists), `/checkouts/one` — the one their `llms.txt` index names — answers 400, identical to a route that does not exist.

  **The plugin is multi-provider too, not just the types.** `payments({ providers })` on the top-level import holds the gateways, one idempotency store and one handler registry, so a webhook route is `plugin.handleWebhook(gateway, request)`. Until now the contract knew several gateways while the thing a consumer actually wires into `theo.config.ts` knew exactly one — the `/stripe` factory returning `getStripeClient()`.

  Providers are keyed by the name the app routes them under rather than by `provider.name`: two Stripe accounts is a real shape (marketplace, separate legal entities) and deriving the key would silently collapse them. No route is auto-registered — a plugin claiming `/api/payments/webhook` collides with the app that already had one.

  The single-gateway Stripe factory is renamed `stripePayments()`. Two factories called `payments` in two subpaths is a footgun, and the one to reach for by default is the multi-provider one. It keeps its reason to exist: it pairs with `defineStripeWebhook`, which narrows `Stripe.Event` in a way the neutral contract cannot express.

  ```diff
  -import { payments } from '@theokit/plugin-payments/stripe'
  +import { stripePayments } from '@theokit/plugin-payments/stripe'
  ```

  Five new tests run the webhook path against Stripe's **real** signature crypto — `generateTestHeaderString` producing a genuine `t=…,v1=…`, verified by the untouched `constructEvent` — covering a tampered body, a wrong secret and a stale timestamp. Every other test of that path mocks `constructEvent`, so none of them ever ran the HMAC and none could catch our wiring mangling the raw body. They were written in the e2e package and moved out of it: they make no network call, and gating credential-free assertions behind a credential trades feedback on every push for feedback once a night.

- c351485: The plugins are TheoKit adapters now, and two of them stop typing against an API that does not exist (#42).

  Measured across the eleven packages: **none** used the framework's plugin authoring API, and two declared a local `TheoPluginApp` describing methods `TheoApp` does not have — `registerRoute`/`hasRoute` in payments, `registerModule`/`registerCliCommand`/`registerDevtoolsTab`/`hasCliCommand` in db-drizzle. Both type-checked, because TypeScript is structural and the parameter was never used. The real contract is `{ addHook, decorateRequest }`, and `import type` is erased at build — so importing the real one costs nothing at runtime, which `plugin-voice` had been documenting two directories away.

  **`@theokit/plugin-payments`** — `register()` publishes the gateways on `ctx.payments`, the `@InjectStripeClient` equivalent:

  ```ts
  const result = await ctx.payments.handleWebhook(params.gateway, { rawBody, headers, url })
  ```

  That surface is deliberately narrower than the plugin — `providers`, `provider(key)`, `handleWebhook`, and **not** `store` or `registry`. The narrowing buys a safety property rather than tidiness: a handler holding `store` can claim or release an event id outside the dispatcher and defeat idempotency; one holding `registry` can rewire routing mid-request.

  `stripePayments()` publishes the client on `ctx.stripe` and resolves it **at boot**, so a missing `STRIPE_SECRET_KEY` crashes on startup instead of 500-ing while somebody is paying.

  **`@theokit/plugin-db-drizzle`** — `register()` used to call the invented methods behind `if (app.registerCliCommand)` guards, so seven documented CLI verbs and a devtools tab were a silent no-op for several releases (#43). The dead branches are gone and `register()` is now empty _by decision_, with the reason stated: this plugin has no runtime surface to publish.

  `buildDbCommands` and `buildDevtoolsTab` are **exported** — they were reachable only from a `register()` calling a nonexistent API and from their own ~30 assertions, so exporting them un-hides surface that already existed and was already tested. The README no longer promises `theokit db <verb>`, which the `theokit` CLI (build / dev / doctor / start) has never had; it shows the script you wire yourself, and that example was executed before shipping.

  **BREAKING** in both: `TheoPluginApp` is gone. `register(app)` now takes the framework's `TheoApp`. Anything calling it with a hand-rolled object needs `{ addHook, decorateRequest }` — which is what the plugin runner has always passed.

### Patch Changes

- fd75f1c: The AbacatePay webhook HMAC contradiction is settled by a real delivery, and the secret has an undocumented second channel (#44).

  Their docs disagreed about which key signs: the webhooks reference says the `secret` you provided, the security page hardcodes a global constant. A public tunnel plus `POST /webhooks/create` made it possible to receive a genuine `transparent.completed` and compare the `X-Webhook-Signature` **they sent** against both candidates.

  It matches `base64(HMAC-SHA256(rawBody, THE_PUBLISHED_CONSTANT))`, and not the merchant secret in base64 or hex. So the signature is computed with a key anyone can read in their own documentation: it proves the body was not altered in transit and **not** that AbacatePay sent it. Verifying it therefore stays opt-in — enabling it by default would add a check that looks like authentication and is not.

  **The security-relevant find: the per-merchant secret also arrives in an `x-webhook-secret` header**, which is documented nowhere. The provider now prefers it over the query string, because a secret in a URL reaches proxy logs, browser history and Referer. `verifyWebhook` accepts the header, the url, or both, and refuses when neither carries the secret — previously it required the url.

  The capture is now an offline regression fixture (`tests/abacatepay-real-delivery.test.ts`) that runs on every push with no credential. One of its assertions states that the signature does **not** verify under the merchant secret: if AbacatePay switches, that test goes red and says the default needs revisiting, instead of the change passing unnoticed.

  Two more things their docs omit, found on the way: `POST /webhooks/create` requires a `secret` of **at least 32 characters**, and `POST /webhooks/delete` needs more than the "Leitura e escrita" scope — it answers "Insufficient permissions".

- 97aaf84: The AbacatePay provider is exercised against the live sandbox API, and three defects came out of it (#41).

  Until now every AbacatePay path was written from published documentation and covered only against a fake `fetch`, with the README saying so in a warning block. Twelve live assertions now cover hosted checkout, inline PIX with a payable BR Code, status reconciliation across both resource kinds, a full refund confirmed by **re-reading the charge**, and the typed refusals. Writing them refuted the documentation three times.

  **A successful refund was reported as a failure.** The docs show `{ refundPublicId }`; the API returns `{ id, status: "COMPLETE", amount, originalId, createdAt }`. Reading only the documented key made the provider throw `refund_failed` on **every refund that worked** — and no unit test could catch it, because the fake was written from the same docs. Both keys are accepted now, and the fake teaches the measured shape.

  **Refund routing by id prefix is restored.** The docs' prefix table claims `/checkouts/refund` accepts `bill_`, `char_`, `pix_char_` and `card_`, which made the branch look like one that could only be wrong — it was removed on exactly that argument. The API: `POST /checkouts/refund { id: "pix_char_…" }` answers `"Use a rota /v2/transparents/refund para reembolsar cobranças transparentes."`

  **`methods` is now a provider option, and PIX-only stores need it.** Without it, `/checkouts/create` inherits the API default and answers `"CARD is not available for this store"`, so no checkout could be created at all. AbacatePay has since commented CARD out of its own docs.

  ```ts
  AbacatePayProvider({ apiKey: process.env.ABACATEPAY_API_KEY!, methods: ['PIX'] })
  ```

  Sandbox is enforced, not assumed: a key that does not start with `abc_dev_` is treated as _not configured_, mirroring the `sk_test_` rule, and every resource created comes back `devMode: true`.

  Still uncovered, for measured reasons: subscriptions (AbacatePay commented the section out of its docs; the endpoint answers `"PIX Automático is not available for this store"`), inbound webhook delivery (needs a public HTTPS endpoint), and `GET /store/get` (a documented route that answers "Not found").

## 0.2.1

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.

## 0.2.0

### Minor Changes

- 0756375: **BREAKING (pre-1.0):** `IdempotencyStore` now requires a `release(eventId)` method, and `IdempotencyRepository` now requires `delete(eventId)`. This makes the webhook dispatcher exactly-once on success AND retry-on-failure (#167): an event is claimed before dispatch and released if the handler throws, so Stripe's retry re-runs it instead of silently deduping a failed delivery. Consumers providing a custom `IdempotencyStore`/`IdempotencyRepository` must implement the new method(s). Webhook handlers must be idempotent (multi-handler partial failure re-runs succeeded handlers on retry).
- 7baea9d: **BREAKING (pre-1.0):** `WebhookResult`'s `handler_error` variant now carries a sanitized `error: { code: string; message: string }` instead of the raw thrown error (`error: unknown`). This prevents handler errors — which may contain PII/secrets (DB DSNs, API keys) — from leaking to the HTTP layer (#201). The full error is logged server-side with known secret shapes redacted. Additionally, `WebhookRegistry.dispatch` now throws a single `AggregateError` carrying every failed handler's error instead of only the first (#208). Consumers reading `result.error` must switch from the raw error to `result.error.code` / `result.error.message`; consumers calling `registry.dispatch` directly should expect `AggregateError`.

### Patch Changes

- c43d8e6: Redact secrets in the idempotency-claim release-failure log (review finding F-dom-pay-5). When a webhook handler throws, `processWebhook` best-effort releases the idempotency claim; if that `release()` itself throws, the error was previously logged raw, so a `release()` failure carrying credentials (e.g. a DB connection string) could leak into the server log. The error is now passed through `redactSecrets()` before logging, matching the handler-error log path. No public API change.

## [Unreleased]

## [0.1.0] - 2026-06-04 (initial publish on `@next`)

Per plan [`p6-plugin-payments-plan.md`](../../../.claude/knowledge-base/plans/p6-plugin-payments-plan.md) v1.0 and blueprint [`p6-plugin-payments-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/p6-plugin-payments-blueprint.md) v1.0 (SHIPPABLE 99.5/100). Form 4 Hybrid — `defineStripeWebhook` typed dispatcher + Stripe SDK re-export + Checkout helper + idempotency store (memory or @theokit/orm-backed).

### Added

- **`payments(opts: PaymentsOptions): PaymentsPlugin`** factory. Pass to `theo.config.ts > plugins: [...]`. Resolves `secretKey` / `webhookSecret` from `process.env.STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` when omitted.
- **`defineStripeWebhook<T>(eventType, handler)`** typed dispatcher factory. Handler receives narrowed `Stripe.Event` variant via discriminated union (`Extract<Stripe.Event, {type: T}>`).
- **`WebhookRegistry`** class with `register(handler)` + `dispatch(event)` + `hasHandlersFor(type)`. LIFO dispatch order; unhandled types are no-op (no error).
- **`verifyAndParseWebhook(stripe, rawBody, signatureHeader, secret)`** wrapper around `stripe.webhooks.constructEvent()` with typed `StripeSignatureError`.
- **`processWebhook({stripe, rawBody, signatureHeader, webhookSecret, registry, store})`** high-level handler combining signature verification + idempotency check + dispatcher. Returns discriminated `WebhookResult` (`ok` / `signature_invalid` / `handler_error`).
- **`createCheckoutSession(client, params)`** helper wrapping `stripe.checkout.sessions.create()` with `{url, sessionId}` envelope return. Throws `CheckoutSessionMisconfigError` when session lacks URL (Elements mode without proper config).
- **`IdempotencyStore`** interface + **`createMemoryStore()`** (dev/test default) + **`createOrmStore(repo)`** (production-grade via @theokit/orm). Memory store uses single-flight Promise map for concurrent-safety.
- **`createStripeClientGetter(opts)`** lazy singleton factory. Each plugin instance gets its own client; `dispose()` clears cache (test isolation). `appInfo` auto-populated.
- **`formatAmountForStripe(amount, currency)`** + **`formatAmountForDisplay(amount, currency)`** currency helpers — handles zero-decimal (JPY) vs decimal (USD/EUR) correctly via `Intl.NumberFormat`.
- **`Stripe`** type re-export for consumer ergonomics (consumer provides runtime via peerDep).

### Notes

- **Stripe SDK is REQUIRED peer.** Consumer installs `stripe@>=14.0.0`. Plugin imports types-only at compile time; runtime `new Stripe()` happens inside `createStripeClientGetter`.
- **`@theokit/orm` is OPTIONAL peer.** Default memory store works without it. Production multi-replica deploys MUST swap to `createOrmStore(repo)` to prevent double-processing across replicas.
- **Checkout v0.1 = hosted-page passthrough only.** Stripe Elements embedded checkout deferred to v0.x patch (adds `@stripe/react-stripe-js` + `@stripe/stripe-js` + React peer).
- **Subscriptions = consumer-owned state machine.** Plugin documents 7 canonical events (`customer.subscription.{created,updated,deleted,trial_will_end}`, `invoice.payment_{succeeded,failed}`, `checkout.session.completed`); consumer wires Repository per their data model. No opinionated state machine ships in v0.1.
- **Raw-body requirement.** Webhook routes MUST consume raw bytes BEFORE any other body access. README documents Vercel pages-router workaround + Cloudflare Workers pattern.
- **No auto-route-registration.** v0.1 plugin's `register(app)` does NOT mount routes — consumer wires their own `defineRoute('/api/payments/webhook', ...)` and invokes `processWebhook(...)` inside. Future v0.x may add `autoRegisterRoutes: true` opt-in.

### Security threats addressed

| Threat            | Mitigation                                                                  |
| ----------------- | --------------------------------------------------------------------------- |
| Replay attacks    | Idempotency store rejects duplicate `event.id` via atomic UNIQUE constraint |
| Signature forgery | HMAC-SHA256 via `stripe.webhooks.constructEvent()`                          |
| Body tampering    | Signature verification consumes raw body BEFORE JSON parsing                |
| Secret leakage    | Env-var defaults; plugin never logs secrets                                 |
| Double-processing | Idempotency table guarantees exactly-once per `event.id`                    |

### Quality gates

- 36 unit + integration tests GREEN (6 factory + 4 stripe-client + 6 idempotency + 13 webhook + 7 checkout/currency).
- `npx tsc --noEmit`: exit 0.
- `npx tsup src/index.ts --format esm --dts --clean`: dist `6.05 KB` JS + `12.98 KB` d.ts.
- Zero new npm packages introduced — plugin is a thin layer over existing `stripe` SDK + theokit + optional @theokit/orm.

### Quality gates (deferred to dogfood-app cohort)

- **dogfood-app smoke test** — wiring `payments({secretKey: STRIPE_TEST_KEY})` into `dogfood-app/theo.config.ts` + real Stripe test API call. Gated on calendar window ~2026-07-15+ (alongside @theokit/orm + theokit @latest promote).
- **Real drizzle-kit child_process spawn validation** — Phase 3 T3.3 dogfood requirement.
