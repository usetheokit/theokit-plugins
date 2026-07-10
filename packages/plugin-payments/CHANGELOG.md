# @theokit/plugin-payments

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
