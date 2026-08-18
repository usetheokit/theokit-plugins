/**
 * Stripe, behind the neutral provider contract.
 *
 * The mapping choices worth knowing:
 *
 * - `CheckoutItem.ref` becomes a Stripe `price` id. Stripe also accepts inline
 *   `price_data`, but accepting either here would make `ref` mean two things,
 *   and a consumer needing full control should build the session with the SDK
 *   directly — `client` is exposed for exactly that.
 *
 * - `idempotencyKey` maps to Stripe's REQUEST-level idempotency option, not to
 *   anything in the params. That distinction has bitten this repository before:
 *   `@theokit/plugin-email` put the key in the message payload for months and
 *   Resend never deduplicated a thing.
 *
 * - `verifyWebhook` delegates to `stripe.webhooks.constructEvent`, which does
 *   HMAC-SHA256 over the raw body plus a timestamp tolerance. Hand-rolling that
 *   would mean reimplementing replay protection.
 */

import type Stripe from 'stripe'

import { definePaymentProvider } from '../provider.js'
import {
  type CheckoutInput,
  type CheckoutResult,
  type CheckoutStatus,
  type PartialRefundCapableProvider,
  type PartialRefundInput,
  type PaymentEvent,
  type PaymentEventType,
  PaymentProviderError,
  type PaymentStatus,
  type RefundInput,
  type RefundResult,
  type SubscriptionCapableProvider,
  type SubscriptionStatus,
  type WebhookRequest,
  WebhookSignatureError,
} from '../provider-types.js'

const PROVIDER = 'stripe'

export interface StripeProviderOptions {
  /** A configured Stripe client. The plugin never constructs one — `stripe` is a peer. */
  readonly client: Stripe
  /** Endpoint signing secret (`whsec_…`); required only to verify webhooks. */
  readonly webhookSecret?: string
}

/**
 * Stripe event names are namespaced and numerous. Only the ones a consumer
 * would branch on are mapped; everything else arrives as `unknown` carrying its
 * original name, because inventing a bucket for an unrecognised event throws
 * away the only thing that could be acted on.
 */
const EVENT_MAP: Readonly<Record<string, PaymentEventType>> = {
  'checkout.session.completed': 'checkout.completed',
  'checkout.session.async_payment_succeeded': 'checkout.completed',
  'checkout.session.expired': 'checkout.expired',
  'checkout.session.async_payment_failed': 'payment.failed',
  'payment_intent.payment_failed': 'payment.failed',
  'charge.refunded': 'payment.refunded',
  'charge.dispute.created': 'payment.disputed',
}

/**
 * A Checkout Session reports two things that both matter and neither of which
 * is "paid": `status` is the lifecycle of the PAGE (open / complete / expired)
 * and `payment_status` is the lifecycle of the MONEY (unpaid / paid /
 * no_payment_required). A session can be `complete` and `unpaid` — an
 * asynchronous method still settling — so reading either alone gets it wrong in
 * a way that fulfils unpaid orders.
 *
 * Measured 2026-08-18 on a fresh session: `status=open`, `payment_status=unpaid`.
 */
function sessionStatus(session: Stripe.Checkout.Session, refunded: number): PaymentStatus {
  if (refunded > 0) return 'refunded'
  if (session.status === 'expired') return 'expired'
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    return 'paid'
  }
  // `open` and `complete` both land on pending here, and that is the point: a
  // complete-but-unpaid session is an asynchronous method still settling, not a
  // sale. Two branches returning the same value would imply a distinction the
  // caller does not have.
  if (session.status === 'open' || session.status === 'complete') return 'pending'
  return 'unknown'
}

/** Resolve whatever the caller passed into something /v1/refunds accepts. */
async function resolvePaymentIntent(client: Stripe, reference: string): Promise<string> {
  if (!reference.startsWith('cs_')) return reference
  // A session is not a payment. Refunding one means finding the intent behind
  // it, and an unpaid session has none — which is a clearer refusal from us than
  // Stripe's "No such payment_intent: cs_…", the message it actually returns
  // when a session id is passed straight through (measured 2026-08-18).
  const session = await client.checkout.sessions.retrieve(reference)
  const pi = session.payment_intent
  const id = typeof pi === 'string' ? pi : (pi?.id ?? undefined)
  if (id === undefined) {
    throw new PaymentProviderError(
      PROVIDER,
      'nothing_to_refund',
      `Checkout session ${reference} has no payment intent, so nothing was ever charged (payment_status=${String(session.payment_status)}).`,
    )
  }
  return id
}

function refundResult(refund: Stripe.Refund): RefundResult {
  return {
    id: refund.id,
    provider: PROVIDER,
    amountInCents: refund.amount,
    raw: refund,
  }
}

export function StripeProvider(
  opts: StripeProviderOptions,
): PartialRefundCapableProvider & SubscriptionCapableProvider {
  if (opts.client === undefined || opts.client === null) {
    throw new TypeError('StripeProvider requires { client } — a configured Stripe instance')
  }

  return definePaymentProvider({
    name: PROVIDER,

    async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
      const params: Stripe.Checkout.SessionCreateParams = {
        // Stripe takes both modes on the same endpoint, so this is a passthrough.
        // It refuses a mismatch itself ("You specified `payment` mode but passed
        // a recurring price"), which is a better error than one we could invent
        // without knowing the catalogue.
        mode: input.mode ?? 'payment',
        line_items: input.items.map((i) => ({ price: i.ref, quantity: i.quantity })),
        ...(input.successUrl !== undefined ? { success_url: input.successUrl } : {}),
        ...(input.cancelUrl !== undefined ? { cancel_url: input.cancelUrl } : {}),
        ...(input.customerRef !== undefined ? { customer: input.customerRef } : {}),
        ...(input.currency !== undefined ? { currency: input.currency.toLowerCase() } : {}),
        ...(input.metadata !== undefined ? { metadata: { ...input.metadata } } : {}),
      }

      let session: Stripe.Checkout.Session
      try {
        session = await opts.client.checkout.sessions.create(
          params,
          // Request-level, NOT part of the payload. See the file docstring.
          input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : undefined,
        )
      } catch (cause) {
        throw new PaymentProviderError(
          PROVIDER,
          'checkout_failed',
          `Stripe refused the checkout session: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        )
      }

      if (session.url === null || session.url === undefined) {
        // Stripe returns a null url for embedded (ui_mode) sessions. The neutral
        // contract promises a redirect URL, so this is a misconfiguration rather
        // than a value to pass along as empty.
        throw new PaymentProviderError(
          PROVIDER,
          'missing_checkout_url',
          'Stripe created a session without a URL. Hosted mode needs success_url and cancel_url; embedded sessions are not served by this contract.',
        )
      }

      return { id: session.id, url: session.url, provider: PROVIDER, raw: session }
    },

    // `async` is load-bearing, not stylistic. The declared return type is a
    // Promise, so every failure must arrive as a rejection — a synchronous
    // throw escapes a caller's `.catch()` and crashes the request instead.
    // `async` here is not about awaiting: it turns every throw below into a
    // rejection, which the declared Promise return type promises. Dropping it
    // lets a sync throw escape a caller's .catch() — the provider tests fail
    // if this is removed.
    // eslint-disable-next-line @typescript-eslint/require-await
    async verifyWebhook(req: WebhookRequest): Promise<PaymentEvent> {
      if (opts.webhookSecret === undefined || opts.webhookSecret.length === 0) {
        throw new PaymentProviderError(
          PROVIDER,
          'missing_webhook_secret',
          'StripeProvider needs { webhookSecret } to verify webhooks (the whsec_… endpoint secret).',
        )
      }
      // Header lookup is case-insensitive: Node lowercases incoming headers, but
      // a consumer forwarding a map from another framework may not have.
      const signature = req.headers['stripe-signature'] ?? req.headers['Stripe-Signature']
      if (signature === undefined || signature.length === 0) {
        throw new WebhookSignatureError(
          PROVIDER,
          'Missing stripe-signature header — Stripe always sends one, so its absence means the request did not come from Stripe (or a proxy stripped it).',
        )
      }

      let event: Stripe.Event
      try {
        event = opts.client.webhooks.constructEvent(req.rawBody, signature, opts.webhookSecret)
      } catch (cause) {
        throw new WebhookSignatureError(
          PROVIDER,
          `Webhook signature verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }

      return {
        type: EVENT_MAP[event.type] ?? 'unknown',
        id: event.id,
        providerEventType: event.type,
        provider: PROVIDER,
        raw: event,
      }
    },

    async retrieveCheckout(reference: string): Promise<CheckoutStatus> {
      let session: Stripe.Checkout.Session
      try {
        // The expansion is what makes the refunded state visible from a session
        // at all — without it the answer to "was this refunded?" is a second
        // round trip the caller has to know to make. Verified accepted on a real
        // session 2026-08-18.
        session = await opts.client.checkout.sessions.retrieve(reference, {
          expand: ['payment_intent.latest_charge'],
        })
      } catch (cause) {
        throw new PaymentProviderError(
          PROVIDER,
          'retrieve_failed',
          `Stripe could not return checkout session ${reference}: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        )
      }

      const intent = typeof session.payment_intent === 'string' ? undefined : session.payment_intent
      const charge =
        intent !== null && intent !== undefined && typeof intent.latest_charge !== 'string'
          ? intent.latest_charge
          : undefined
      const refunded = charge?.amount_refunded ?? 0

      return {
        id: session.id,
        status: sessionStatus(session, refunded),
        provider: PROVIDER,
        ...(session.amount_total !== null ? { amountInCents: session.amount_total } : {}),
        amountRefundedInCents: refunded,
        ...(session.currency !== null ? { currency: session.currency.toUpperCase() } : {}),
        raw: session,
      }
    },

    async refund(input: RefundInput): Promise<RefundResult> {
      return refundResult(await createRefund(opts.client, input))
    },

    async cancelSubscription(reference: string): Promise<SubscriptionStatus> {
      let id = reference
      if (reference.startsWith('cs_')) {
        // The caller almost always kept the checkout id and never saw the
        // `sub_…` come into existence — it is created when the customer pays.
        const session = await opts.client.checkout.sessions.retrieve(reference)
        const sub = session.subscription
        const resolved = typeof sub === 'string' ? sub : (sub?.id ?? undefined)
        if (resolved === undefined) {
          throw new PaymentProviderError(
            PROVIDER,
            'no_subscription',
            `Checkout session ${reference} started no subscription — either it was a one-off payment, or nobody has paid it yet.`,
          )
        }
        id = resolved
      }

      let cancelled: Stripe.Subscription
      try {
        cancelled = await opts.client.subscriptions.cancel(id)
      } catch (cause) {
        throw new PaymentProviderError(
          PROVIDER,
          'cancel_failed',
          `Stripe refused to cancel subscription ${id}: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        )
      }

      return {
        id: cancelled.id,
        // Only `canceled` is reported as cancelled. Stripe's other terminal-ish
        // states (`incomplete_expired`, `unpaid`) are not the same thing, and
        // folding them in would tell a consumer the cancel worked when it did
        // not run at all.
        status: cancelled.status === 'canceled' ? 'cancelled' : 'unknown',
        provider: PROVIDER,
        raw: cancelled,
      }
    },

    async refundPartial(input: PartialRefundInput): Promise<RefundResult> {
      if (!Number.isInteger(input.amountInCents) || input.amountInCents <= 0) {
        throw new PaymentProviderError(
          PROVIDER,
          'invalid_amount',
          `amountInCents must be a positive integer; received ${String(input.amountInCents)}.`,
        )
      }
      return refundResult(await createRefund(opts.client, input, input.amountInCents))
    },
  })
}

async function createRefund(
  client: Stripe,
  input: RefundInput,
  amountInCents?: number,
): Promise<Stripe.Refund> {
  const paymentIntent = await resolvePaymentIntent(client, input.reference)
  try {
    return await client.refunds.create(
      {
        payment_intent: paymentIntent,
        ...(amountInCents !== undefined ? { amount: amountInCents } : {}),
        ...(input.reason !== undefined ? { metadata: { reason: input.reason } } : {}),
      },
      // Request-level, as with checkout. A refund retried without this is a
      // second refund, which is the expensive direction to get wrong.
      input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : undefined,
    )
  } catch (cause) {
    throw new PaymentProviderError(
      PROVIDER,
      'refund_failed',
      `Stripe refused the refund of ${input.reference}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    )
  }
}
