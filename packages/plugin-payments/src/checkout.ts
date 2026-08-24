/**
 * @theokit/plugin-payments — Checkout session helper.
 *
 * Per plan p6-plugin-payments v1.0 § Phase 2 / T2.4.
 * Blueprint Q1 — wraps `stripe.checkout.sessions.create(params)` with a returnful envelope,
 * discriminated by ui mode: a hosted session carries the redirect `url`, an embedded one carries
 * the `clientSecret` its client-side SDK needs.
 *
 * The doc-comment here used to say embedded was "deferred to v0.x", and that was the sentence
 * B-013 quoted. It was true about the ENVELOPE and misleading about the request: `params` are
 * passed verbatim, so a caller could always ask Stripe for an embedded session — and then hit a
 * throw on the null url that Stripe returns by design for that mode.
 */

import type Stripe from 'stripe'

/** Common to both envelopes: what identifies the session regardless of how it is presented. */
interface CheckoutSessionResultCommon {
  /** Stripe-assigned session ID for downstream lookup / webhook correlation. */
  readonly sessionId: string
}

/** A hosted session: Stripe serves the page, so there is somewhere to redirect. */
export interface HostedCheckoutSessionResult extends CheckoutSessionResultCommon {
  readonly uiMode: 'hosted'
  /** URL the consumer should redirect the user to (Stripe-hosted page). */
  readonly url: string
}

/** An embedded session: the consumer mounts the form, so there is a secret instead of a URL. */
export interface EmbeddedCheckoutSessionResult extends CheckoutSessionResultCommon {
  readonly uiMode: 'embedded'
  /** What the consumer hands Stripe's client-side SDK to mount the payment form. */
  readonly clientSecret: string
}

/**
 * Envelope returned by `createCheckoutSession`.
 *
 * Narrow on `uiMode` to reach the field that mode carries. `url` stays REQUIRED on the hosted
 * branch: it is what every existing caller reads, and making it optional would move a compile-time
 * guarantee into a runtime check for everyone who never uses embedded.
 */
export type CheckoutSessionResult = HostedCheckoutSessionResult | EmbeddedCheckoutSessionResult

/**
 * Error thrown when a session comes back without the field its mode requires — a hosted session
 * with no URL, or an embedded one with no client secret.
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
 * Throws `CheckoutSessionMisconfigError` when the session lacks the field its mode requires: a
 * URL for hosted, a client secret for embedded. A null `url` on an embedded session is the shape,
 * not a fault, which is why the mode is read from the request rather than guessed from the
 * response.
 */
export async function createCheckoutSession(
  client: Stripe,
  params: Stripe.Checkout.SessionCreateParams,
): Promise<CheckoutSessionResult> {
  const session = await client.checkout.sessions.create(params)

  if (params.ui_mode === 'embedded') {
    if (typeof session.client_secret !== 'string' || session.client_secret.length === 0) {
      throw new CheckoutSessionMisconfigError(
        'Stripe created an embedded Checkout session without a client secret. There is nothing to mount the payment form with.',
      )
    }
    return { uiMode: 'embedded', clientSecret: session.client_secret, sessionId: session.id }
  }

  if (!session.url) {
    throw new CheckoutSessionMisconfigError(
      "Stripe Checkout session was created without a URL. Ensure success_url and cancel_url are set for hosted-page mode (ui_mode='hosted' default).",
    )
  }
  return { uiMode: 'hosted', url: session.url, sessionId: session.id }
}
