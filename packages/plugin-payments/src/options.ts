/**
 * @theokit/plugin-payments — option shapes.
 *
 * Per plan p6-plugin-payments v1.0 § Phase 1 / T1.2.
 * Blueprint Recommendations § concrete plugin shape.
 */

import type Stripe from "stripe";
import type { IdempotencyStore } from "./idempotency-store.js";

/** Stripe API version pin. Defaults to "2023-10-16" (Stripe Node SDK 14.x default). */
export type StripeApiVersion = Stripe.LatestApiVersion  ;

/**
 * User-facing options for the `payments()` factory.
 *
 * Both `secretKey` and `webhookSecret` are resolved lazily at register-time
 * from `process.env.STRIPE_SECRET_KEY` / `process.env.STRIPE_WEBHOOK_SECRET`
 * when omitted (canonical Stripe SDK pattern).
 */
export interface PaymentsOptions {
  /** Stripe secret key. Defaults to `process.env.STRIPE_SECRET_KEY`. */
  secretKey?: string;
  /** Stripe webhook signing secret. Defaults to `process.env.STRIPE_WEBHOOK_SECRET`. */
  webhookSecret?: string;
  /** Stripe API version pin. Default: `"2023-10-16"`. */
  apiVersion?: StripeApiVersion;
  /** Idempotency store. Default: memory store created lazily. */
  idempotencyStore?: IdempotencyStore;
}

/** Fully-resolved options shape. */
export interface ResolvedPaymentsOptions {
  readonly secretKey: string | undefined;
  readonly webhookSecret: string | undefined;
  readonly apiVersion: StripeApiVersion;
  readonly idempotencyStore: IdempotencyStore | undefined;
}

const DEFAULT_API_VERSION: StripeApiVersion = "2023-10-16";

/**
 * Apply defaults + env-var fallbacks to user-provided options.
 *
 * - `secretKey` -> `opts.secretKey ?? env.STRIPE_SECRET_KEY`
 * - `webhookSecret` -> `opts.webhookSecret ?? env.STRIPE_WEBHOOK_SECRET`
 * - `apiVersion` -> `opts.apiVersion ?? "2023-10-16"`
 * - `idempotencyStore` -> passed through (factory wires memory default at register-time)
 *
 * Pure; no I/O beyond `process.env` access.
 */
export function resolveOptions(opts: PaymentsOptions = {}): ResolvedPaymentsOptions {
  return {
    secretKey: opts.secretKey ?? process.env.STRIPE_SECRET_KEY,
    webhookSecret: opts.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET,
    apiVersion: opts.apiVersion ?? DEFAULT_API_VERSION,
    idempotencyStore: opts.idempotencyStore,
  };
}
