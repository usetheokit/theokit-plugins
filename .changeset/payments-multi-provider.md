---
'@theokit/plugin-payments': minor
---

Multi-provider: Stripe and AbacatePay behind one neutral contract. **Breaking.**

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

| Method | Why it is in the base contract |
| --- | --- |
| `retrieveCheckout(reference)` | Webhook delivery is at-least-once, which is not at-least-one. A dropped delivery, a deploy inside the retry window, or an endpoint that 500s past the give-up point all end with a paid customer and an unfulfilled order. Reconciliation needs a way to ASK. |
| `refund(input)` | Both gateways refund in full. Partial refunds are a capability (`supportsPartialRefund`) because AbacatePay refunds integrally and documents that it does. |

`mode: 'subscription'` on `CheckoutInput` closes #39 — the contract previously hardcoded `mode: 'payment'`, so it could not begin a recurring charge on either provider. Ending one is `cancelSubscription`, behind `supportsSubscriptions`. The split follows a rule rather than a mood: a **value** a provider cannot serve is validated and refused at runtime (AbacatePay rejects non-BRL the same way), while a **method** it does not have must be visible to the compiler, or every consumer writes a call that type-checks and throws.

**Verified against the live Stripe API, without a browser.** Thirteen assertions run nightly, including the ones a fake cannot support: the same idempotency key returning the same session; a real charge confirmed with `pm_card_visa` then refunded in full and in part; a real `active` subscription cancelled and then re-read from Stripe to confirm it stuck. The AbacatePay provider is implemented from published documentation and covered only against a fake — nobody here has an account, and the README says so where a reader will see it before wiring it.

That distinction earned its keep immediately: AbacatePay's own docs contradict themselves on the status endpoint, and measuring settled it. `/checkouts/get` answers 401 unauthenticated (exists), `/checkouts/one` — the one their `llms.txt` index names — answers 400, identical to a route that does not exist.
