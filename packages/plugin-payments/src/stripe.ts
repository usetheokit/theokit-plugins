/**
 * `@theokit/plugin-payments/stripe` — everything Stripe-specific.
 *
 * Two levels, both supported:
 *
 * - {@link StripeProvider} implements the neutral `PaymentProvider`, so the
 *   same application code drives Stripe and AbacatePay.
 * - `defineStripeWebhook` / `WebhookRegistry` / `processWebhook` keep the
 *   fully-typed Stripe event union, with `Extract<Stripe.Event, {type: T}>`
 *   narrowing the neutral contract cannot express. Code that branches on
 *   `payment_intent.processing` needs Stripe's own types, and normalising them
 *   away would be a downgrade, not an abstraction.
 *
 * Importing this subpath is what pulls in the `stripe` peer dependency.
 *
 * @public
 */

import type Stripe from 'stripe'

import { createMemoryStore } from './idempotency-store.js'
import { type PaymentsOptions, resolveOptions } from './options.js'
import { createStripeClientGetter } from './stripe-client.js'
import type { PaymentsPlugin, TheoApp } from './types.js'

export { StripeProvider, type StripeProviderOptions } from './providers/stripe.js'

export type { PaymentsOptions, ResolvedPaymentsOptions, StripeApiVersion } from './options.js'
export type { PaymentsPlugin, StripeWebhookHandler, TheoApp, TheoPlugin } from './types.js'

export {
  defineStripeWebhook,
  processWebhook,
  StripeSignatureError,
  verifyAndParseWebhook,
  WebhookRegistry,
  type WebhookResult,
} from './webhook.js'

export {
  CheckoutSessionMisconfigError,
  createCheckoutSession,
  type CheckoutSessionResult,
} from './checkout.js'

export { createStripeClientGetter, StripeSecretKeyMissingError } from './stripe-client.js'

// Re-export the Stripe namespace type for consumer convenience. Consumers can
// use `Stripe.Event`, `Stripe.Checkout.Session`, etc. without a separate
// `stripe` import. The runtime `Stripe` class is NOT re-exported — that
// remains the consumer's responsibility (peerDep).
export type { Stripe }

/**
 * A single-gateway plugin backed by Stripe, resolving its keys from the
 * environment.
 *
 * Named apart from the neutral `payments()` on the top-level import on purpose:
 * two factories called the same thing in two subpaths is a footgun, and the one
 * that should be reached for by default is the multi-provider one.
 *
 * This exists because the Stripe-typed webhook path — `defineStripeWebhook`,
 * `WebhookRegistry`, `processWebhook` — narrows `Stripe.Event` in a way the
 * neutral contract cannot express, and code that branches on
 * `payment_intent.processing` genuinely needs it. Reach for this when you take
 * one gateway and want its own event types; reach for `payments()` when you take
 * more than one, or want to be able to.
 *
 * ```ts
 * import { stripePayments } from "@theokit/plugin-payments/stripe";
 * import { defineConfig } from "theokit";
 *
 * export default defineConfig({
 *   plugins: [
 *     stripePayments({
 *       // secretKey / webhookSecret default to env vars
 *       apiVersion: "2023-10-16",
 *     }),
 *   ],
 * });
 * ```
/**
 * The key `ctx.stripe` is published under. Fixed, so a handler can rely on it.
 *
 * Import it rather than retyping the string: a mistyped key is not an error, it is `undefined` at
 * request time, in a handler that looked correct. Mirrors {@link PAYMENTS_DECORATION_KEY}.
 *
 * The name is a VENDOR noun, and `.claude/rules/decoration-keys.md § 2` asks for a plugin noun —
 * a consumer using the Stripe SDK is a plausible claimant of `ctx.stripe`, and the framework
 * resolves that collision silently, last-writer-wins, in *their* app. Changing it is a breaking
 * change to published surface, so it is tracked separately. Importing this const is what makes
 * that migration a one-line change for a consumer instead of a search-and-replace.
 *
 * @public
 */
export const STRIPE_DECORATION_KEY = 'stripe'

/**
 * @public
 */
export function stripePayments(opts: PaymentsOptions = {}): PaymentsPlugin {
  const resolved = resolveOptions(opts)
  // Memory store is created lazily so test isolation works (one store per
  // plugin instance). Production consumers SHOULD pass `idempotencyStore`
  // explicitly via `createOrmStore(repo)` for multi-replica safety.
  // T2.4 (#202): the default memory store is single-process — NOT multi-replica
  // safe. In production, falling back to it silently risks the same Stripe event
  // being processed on more than one replica. Warn loudly (advisory: NODE_ENV may
  // be unset on some runtimes, so this is a best-effort net, not a hard gate).
  if (resolved.idempotencyStore === undefined && process.env.NODE_ENV === 'production') {
    console.warn(
      '[plugin-payments] Using the default in-memory idempotency store in production. ' +
        'It is NOT multi-replica safe — the same Stripe webhook event may be processed ' +
        'more than once across replicas. Pass an explicit `idempotencyStore` ' +
        '(e.g. createOrmStore(repo) backed by a UNIQUE event_id) for production deployments.',
    )
  }
  const store = resolved.idempotencyStore ?? createMemoryStore()
  const clientGetter = createStripeClientGetter(resolved)

  return {
    name: '@theokit/plugin-payments',
    kind: 'payments',
    options: { ...resolved, idempotencyStore: store },
    getStripeClient(): Stripe {
      return clientGetter.get()
    },
    register(app: TheoApp): void {
      // No route is registered because a plugin CANNOT register one: `TheoApp`
      // offers `addHook` and `decorateRequest` and nothing else. Routes come
      // from the `route()` builder in the consumer's own route files, where the
      // handler calls `processWebhook(...)`. Earlier prose here presented that
      // as a design choice and even promised an `autoRegisterRoutes` opt-in;
      // both were written without reading the contract (#42).
      //
      // Resolving the client HERE rather than lazily is what moves a missing
      // key from a 500 mid-payment to a crash at boot (Rule 8, and the same
      // reasoning plugin-voice states for validating options synchronously).
      app.decorateRequest<Stripe>(STRIPE_DECORATION_KEY, clientGetter.get())
    },
  }
}
