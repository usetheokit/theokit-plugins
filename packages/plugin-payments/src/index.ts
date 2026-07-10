/**
 * @theokit/plugin-payments — Stripe-only payments plugin for TheoKit.
 *
 * Per plan p6-plugin-payments v1.0 + blueprint v1.0 (SHIPPABLE 99.5/100).
 * Form 4 Hybrid: `defineStripeWebhook` typed dispatcher + Stripe SDK
 * re-export + Checkout helper + idempotency store (memory or @theokit/orm).
 *
 * @public
 */

import type Stripe from 'stripe'

import { createMemoryStore } from './idempotency-store.js'
import { type PaymentsOptions, resolveOptions } from './options.js'
import { createStripeClientGetter } from './stripe-client.js'
import type { PaymentsPlugin, TheoPluginApp } from './types.js'

export type { PaymentsOptions, ResolvedPaymentsOptions, StripeApiVersion } from './options.js'
export type { PaymentsPlugin, TheoPluginApp, StripeWebhookHandler } from './types.js'

export {
  defineStripeWebhook,
  WebhookRegistry,
  verifyAndParseWebhook,
  processWebhook,
  StripeSignatureError,
  type WebhookResult,
} from './webhook.js'

export {
  createCheckoutSession,
  CheckoutSessionMisconfigError,
  type CheckoutSessionResult,
} from './checkout.js'

export { formatAmountForStripe, formatAmountForDisplay } from './currency.js'

export {
  type IdempotencyStore,
  type IdempotencyRepository,
  createMemoryStore,
  createOrmStore,
} from './idempotency-store.js'

export { StripeSecretKeyMissingError, createStripeClientGetter } from './stripe-client.js'

// Re-export the Stripe namespace type for consumer convenience. Consumers can
// use `Stripe.Event`, `Stripe.Checkout.Session`, etc. without a separate
// `stripe` import. The runtime `Stripe` class is NOT re-exported — that
// remains the consumer's responsibility (peerDep).
export type { Stripe }

/**
 * Create a `@theokit/plugin-payments` plugin instance.
 *
 * ```ts
 * import { payments } from "@theokit/plugin-payments";
 * import { defineConfig } from "theokit";
 *
 * export default defineConfig({
 *   plugins: [
 *     payments({
 *       // secretKey / webhookSecret default to env vars
 *       apiVersion: "2023-10-16",
 *     }),
 *   ],
 * });
 * ```
 *
 * @public
 */
export function payments(opts: PaymentsOptions = {}): PaymentsPlugin {
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
    register(_app: TheoPluginApp): void {
      // v0.1 does NOT auto-register routes — consumer wires their own webhook
      // route via `defineRoute('/api/payments/webhook', { POST: ... })` and
      // calls `processWebhook(...)` inside. This keeps the plugin framework-
      // agnostic and lets consumers choose URL paths.
      //
      // Future v0.x may add `autoRegisterRoutes: true` opt-in.
    },
  }
}
