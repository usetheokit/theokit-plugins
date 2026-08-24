# @theokit/plugin-payments

## 0.6.0

### Minor Changes

- a76d961: Requires `theokit@0.50.1` or newer, and the README examples now declare a route policy.

  TheoKit 0.50.0 made `.policy()` mandatory on every route: a route without one fails `theokit build`, so that "who may call this" is a decision somebody wrote rather than a default nobody read. The `route()` examples in four of these READMEs predated that and had no policy — a reader who copied one got a build failure from our own documentation.

  Every example now declares its policy and says why it is the right one. For the auth packages that is `public`, because a visitor arrives without a session and signing in is what gives them one; for the payments webhook it is `public` because the gateway holds no session of ours and the signature is the authentication.

  The peer floor moves from `>=0.48.7` to `>=0.50.1` for the same reason it moved in the tests: these packages are built, tested and documented against 0.50.1 and against nothing older. The previous range admitted versions nobody here verifies. If you are on `theokit@0.48.x`, the previous release of these packages still installs.

## 0.5.0

### Minor Changes

- 0a812be: Embedded checkout, and a contract that can express it.

  `createCheckout({ uiMode: 'embedded', returnUrl })` returns a `clientSecret` you hand to the
  provider's client-side SDK to mount the payment form inside your own page. Proven against real
  Stripe, not only typed.

  The feature was **unexposed, not unavailable**. Measured live: Stripe accepts `ui_mode: 'embedded'`
  and returns a `client_secret` with `url: null` — and the old contract threw on that null URL before
  reaching the response. It also could not express the request: Stripe answers
  `` `success_url` is not supported with `ui_mode: embedded` `` to the parameters this package sent.

  **Breaking, deliberately.** `CheckoutResult` is discriminated by `uiMode`. Narrow on it to read
  `url` (hosted) or `clientSecret` (embedded):

  ```ts
  const result = await provider.createCheckout({ items, successUrl, cancelUrl })
  if (result.uiMode === 'hosted') redirect(result.url)
  ```

  `url` could have become optional instead. That would have moved a compile-time guarantee into a
  runtime check for every caller who never uses embedded; narrowing keeps the promise where it was.
  Hosted calls written before `uiMode` existed still type-check and still mean the same thing —
  `ui_mode` is not even sent for them, so the request is byte-identical.

  `CheckoutInput` makes the invalid combination unrepresentable: embedded takes `returnUrl`, hosted
  takes `successUrl`/`cancelUrl`, and mixing them does not compile.

  **AbacatePay:** this adapter does not implement embedded checkout and refuses such a request by
  name. Whether the provider offers one is **unverified** — nobody has asked its API, and the
  measurement behind this feature was run against Stripe.

- bf8afd3: Export `STRIPE_DECORATION_KEY` from `@theokit/plugin-payments/stripe`, so the key `ctx.stripe` is published under can be imported instead of retyped. The key's value is unchanged — `ctx.stripe` still works exactly as before, and nothing breaks.

  Retyping it is what this removes: a mistyped key is not an error, it is `undefined` at request time, in a handler that reads correctly. It also makes a future rename a one-line change for you rather than a search-and-replace — the name is a vendor noun, which a plugin key should not be, and changing it will be a breaking release of its own.

## 0.4.0

### Minor Changes

- f71f9bc: The `theokit` peer floor is `>=0.48.7`, the version these packages are actually built against.

  The declared floors ranged from `>=0.1.0-alpha.5` to `>=0.4.0-beta.0` while every one of these
  packages carries `theokit: ^0.48.7` as its devDependency. Those ranges span the framework's move
  from `defineRoute({...})`-style functions to builders, so they admitted versions the code does not
  compile against — and the failure would land in a consumer's build, pointing at our package.

  Two of the old floors were pre-release versions, which promised compatibility with a version the
  framework itself did not consider stable.

  Widening a floor again is welcome, and now has a price: a CI job that builds the package against
  the version being claimed. `check:manifests` fails when a peer floor drops below the
  devDependency the package is built with.

### Patch Changes

- 46b22c8: Seven `@theokit/*` peer dependencies that no package imported are removed.

  Each appeared in the source only inside comments — several of them in comments explaining the
  structural shape chosen precisely to AVOID depending on the package, and one in
  `plugin-payments` stating outright that "plugin doesn't take a peerDep on a specific
  @theokit/orm version". A peer nobody imports is not inert: it drags its own dependency tree into
  the consumer's resolution, which is how `@theokit/plugin-forms` became impossible to install
  with npm (#64).

  Removed: `@theokit/sdk` from plugin-canvas and plugin-realtime, `@theokit/orm` from
  plugin-db-drizzle and plugin-payments, and `@theokit/plugin-canvas`, `@theokit/plugin-voice` and
  `@theokit/ui` from plugin-copilot. Nothing imported them, so no consumer code changes.

## 0.3.1

### Patch Changes

- 03b1b5d: Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

  Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

  Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.

- bfa7409: The README examples now use the API `theokit@0.48` exports, and every one of them was verified by compiling it rather than by reading it. Ten names they told you to import — `defineConfig`, `defineRoute`, `definePlugin`, `defineAction`, `defineAgentTool`, `defineTheoConfig`, `defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`, `useAgentStream` — exist in none of that version's 24 export subpaths. Copying the first block of most of these READMEs produced code that did not compile.

  The `auth-google` and `auth-magic-link` wiring examples changed shape rather than names: the auth orchestrator takes Node's `IncomingMessage`/`ServerResponse`, and no handler surface TheoKit exposes today hands you those, so the examples show a Node server and state the gap.

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
