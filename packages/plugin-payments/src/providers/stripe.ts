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
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
  PaymentProviderError,
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

export function StripeProvider(opts: StripeProviderOptions): PaymentProvider {
  if (opts.client === undefined || opts.client === null) {
    throw new TypeError('StripeProvider requires { client } — a configured Stripe instance')
  }

  return definePaymentProvider({
    name: PROVIDER,

    async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
      const params: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
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
  })
}
