/**
 * @theokit/plugin-payments — Checkout session helper.
 *
 * Per plan p6-plugin-payments v1.0 § Phase 2 / T2.4.
 * Blueprint Q1 — wraps `stripe.checkout.sessions.create(params)` with a
 * returnful `{url, sessionId}` envelope. v0.1 supports hosted-page mode
 * (returns redirect URL); Elements/embedded deferred to v0.x.
 */

import type Stripe from 'stripe'

/** Envelope returned by `createCheckoutSession`. */
export interface CheckoutSessionResult {
  /** URL the consumer should redirect the user to (Stripe-hosted page). */
  readonly url: string
  /** Stripe-assigned session ID for downstream lookup / webhook correlation. */
  readonly sessionId: string
}

/**
 * Error thrown when the Stripe API returns a session without a URL — typically
 * misconfiguration of `success_url` / `cancel_url` in hosted mode.
 */
export class CheckoutSessionMisconfigError extends Error {
  override readonly name = 'CheckoutSessionMisconfigError'
}

/**
 * Create a Stripe Checkout session and return the redirect URL.
 *
 * `params` are passed through verbatim to `stripe.checkout.sessions.create(params)`
 * — consumers have full control over `mode`, `line_items`, `success_url`,
 * `cancel_url`, `metadata`, etc.
 *
 * Throws `CheckoutSessionMisconfigError` if the resulting session lacks a `url`
 * (Stripe returns `null` for embedded-mode sessions; v0.1 supports hosted only,
 * so this signals a consumer misconfiguration).
 */
export async function createCheckoutSession(
  client: Stripe,
  params: Stripe.Checkout.SessionCreateParams,
): Promise<CheckoutSessionResult> {
  const session = await client.checkout.sessions.create(params)
  if (!session.url) {
    throw new CheckoutSessionMisconfigError(
      "Stripe Checkout session was created without a URL. Ensure success_url and cancel_url are set for hosted-page mode (ui_mode='hosted' default).",
    )
  }
  return { url: session.url, sessionId: session.id }
}
