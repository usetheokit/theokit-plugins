/**
 * @theokit/plugin-payments — Stripe SDK lazy singleton.
 *
 * Per plan p6-plugin-payments v1.0 § Phase 1 / T1.3.
 * Blueprint Q1 — mirrors `references/next.js/examples/with-stripe-typescript/lib/stripe.ts`
 * singleton pattern (module-level `new Stripe(...)`) but scoped per plugin
 * instance so multiple `payments()` calls (e.g., test isolation) don't share.
 */

import Stripe from "stripe";

import type { ResolvedPaymentsOptions } from "./options.js";

/**
 * Error thrown when the Stripe client is requested but `secretKey` is missing
 * (neither passed to `payments()` nor present in `process.env.STRIPE_SECRET_KEY`).
 */
export class StripeSecretKeyMissingError extends Error {
  override readonly name = "StripeSecretKeyMissingError";
  constructor() {
    super(
      "Stripe secret key is missing. Pass it to payments({secretKey}) or set process.env.STRIPE_SECRET_KEY.",
    );
  }
}

/**
 * The Stripe API versions the pinned SDK accepts (`Stripe.LatestApiVersion`).
 * Used to validate `apiVersion` at runtime so a JS consumer cannot smuggle an
 * unsupported version past the type system into the SDK (#210).
 */
const ACCEPTED_API_VERSIONS: ReadonlySet<string> = new Set(["2023-10-16"]);

/** Thrown when `apiVersion` is not one the pinned Stripe SDK accepts (#210). */
export class StripeApiVersionError extends Error {
  override readonly name = "StripeApiVersionError";
  constructor(version: string) {
    super(
      `Unsupported Stripe apiVersion "${version}". Accepted: ${[...ACCEPTED_API_VERSIONS].join(", ")}.`,
    );
  }
}

/**
 * Create a lazy Stripe client closure scoped to a single plugin instance.
 *
 * The factory returns a `get()` function that lazily instantiates `new Stripe()`
 * on first call and caches it for subsequent calls. `dispose()` clears the
 * cached instance (useful for tests).
 */
export function createStripeClientGetter(opts: ResolvedPaymentsOptions): {
  get(): Stripe;
  dispose(): void;
} {
  let cached: Stripe | undefined;
  return {
    get(): Stripe {
      if (cached) return cached;
      if (!opts.secretKey) {
        throw new StripeSecretKeyMissingError();
      }
      if (!ACCEPTED_API_VERSIONS.has(opts.apiVersion)) {
        throw new StripeApiVersionError(opts.apiVersion);
      }
      cached = new Stripe(opts.secretKey, {
        // Validated against ACCEPTED_API_VERSIONS above — the narrowing is safe,
        // not a blind cast (#210).
        apiVersion: opts.apiVersion,
        appInfo: {
          name: "@theokit/plugin-payments",
          version: "0.1.0",
          url: "https://theokit.dev",
        },
      });
      return cached;
    },
    dispose(): void {
      cached = undefined;
    },
  };
}
