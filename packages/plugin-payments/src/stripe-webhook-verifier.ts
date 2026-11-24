/**
 * Internal: the one place `stripe.webhooks.constructEvent` is called. The Stripe-typed path
 * (`verifyAndParseWebhook`) and `StripeProvider.verifyWebhook` each map the result to their own
 * error class at the edge.
 */
import type Stripe from 'stripe'

export type StripeVerification =
  | { ok: true; event: Stripe.Event }
  | { ok: false; reason: 'missing_header' }
  | { ok: false; reason: 'invalid'; cause: unknown }

export function verifyStripeSignature(
  stripe: Stripe,
  rawBody: string,
  signatureHeader: string | undefined,
  webhookSecret: string,
): StripeVerification {
  if (signatureHeader === undefined || signatureHeader.length === 0) {
    return { ok: false, reason: 'missing_header' }
  }
  try {
    return {
      ok: true,
      event: stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret),
    }
  } catch (cause) {
    return { ok: false, reason: 'invalid', cause }
  }
}
