/**
 * AbacatePay, behind the neutral provider contract.
 *
 * A Brazilian gateway with a plain REST API and no official Node SDK, so this
 * talks to it over `fetch` — one dependency fewer, and `fetch` is built in from
 * Node 18. The `fetchImpl` option exists so tests do not need a live account.
 *
 * Three things about this API shape the code below:
 *
 * 1. BRL only. `CheckoutInput.currency` is rejected rather than converted when
 *    it is anything else — a payments plugin that quietly changes the currency
 *    of a charge is a payments plugin that loses money.
 *
 * 2. Responses are `{ data, success, error }` and an error can arrive with an
 *    HTTP 200. Checking `res.ok` alone would treat a refusal as a success and
 *    return `undefined` as a checkout URL, so both are checked.
 *
 * 3. No idempotency mechanism is documented. `CheckoutInput.idempotencyKey` is
 *    therefore IGNORED here, deliberately and visibly (see `createCheckout`),
 *    rather than mapped onto `externalId` — `externalId` is a free-text order
 *    reference that AbacatePay does not deduplicate on, so that mapping would
 *    look like retry safety and provide none.
 *
 * Verified against https://docs.abacatepay.com on 2026-08-18.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { definePaymentProvider } from '../provider.js'
import {
  type CheckoutInput,
  type CheckoutResult,
  type PaymentEvent,
  type PaymentEventType,
  PaymentProviderError,
  type PixCapableProvider,
  type PixChargeInput,
  type PixChargeResult,
  type WebhookRequest,
  WebhookSignatureError,
} from '../provider-types.js'

const PROVIDER = 'abacatepay'
const DEFAULT_BASE_URL = 'https://api.abacatepay.com/v2'

/**
 * The HMAC key AbacatePay's own documentation prints in full, in four
 * languages, on a public page.
 *
 * It is exported because a consumer who wants the integrity check should not
 * have to copy a 256-character literal out of a docs page — but it is NOT the
 * default, and that is the point. A key anyone can read authenticates nobody:
 * it proves the body was not altered in transit, not that AbacatePay sent it.
 * The per-merchant `webhookSecret` in the query string is the part that does.
 *
 * AbacatePay's own docs disagree with themselves here — the webhooks reference
 * says payloads are "signed with HMAC using the `secret` you provided", while
 * the security page hardcodes this constant. Defaulting to either reading would
 * be a guess, so `signatureKey` is opt-in and unset means the header is not
 * checked. Verification then rests on the query secret, which both pages agree
 * on. Pass this constant, or your own key, once you have measured which one a
 * real delivery is actually signed with.
 *
 * @see https://docs.abacatepay.com/pages/webhooks/security
 */
export const ABACATEPAY_DOCUMENTED_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface AbacatePayProviderOptions {
  /** API key, sent as `Authorization: Bearer …`. */
  readonly apiKey: string
  /** Override for tests or a sandbox host. Defaults to the v2 production base. */
  readonly baseUrl?: string
  /**
   * The per-merchant secret configured on the webhook, which AbacatePay appends
   * as `?webhookSecret=…`. Required to verify webhooks.
   */
  readonly webhookSecret?: string
  /**
   * Opt-in HMAC key for the `X-Webhook-Signature` header. Unset means the
   * header is not checked — see {@link ABACATEPAY_DOCUMENTED_PUBLIC_KEY} for
   * why this is not defaulted.
   */
  readonly signatureKey?: string
  /** Injection point for tests. Defaults to global `fetch`. */
  readonly fetchImpl?: FetchLike
}

/**
 * Only the two outcomes the neutral enum can carry honestly are mapped.
 *
 * `checkout.lost` / `transparent.lost` mean a dispute was RESOLVED AGAINST the
 * merchant. There is no member for that, and folding it into `payment.disputed`
 * would make a consumer read a final loss as a newly opened dispute — the
 * opposite end of the same story. They arrive as `unknown` with the original
 * name intact, which is less convenient and more true.
 *
 * `subscription.*`, `payout.*` and `transfer.*` are outside what this contract
 * models at all, and reach the consumer the same way.
 */
const EVENT_MAP: Readonly<Record<string, PaymentEventType>> = {
  'checkout.completed': 'checkout.completed',
  'transparent.completed': 'checkout.completed',
  'checkout.refunded': 'payment.refunded',
  'transparent.refunded': 'payment.refunded',
  'checkout.disputed': 'payment.disputed',
  'transparent.disputed': 'payment.disputed',
}

/** The envelope every v2 endpoint answers with. */
interface Envelope<T> {
  readonly data?: T
  readonly success?: boolean
  readonly error?: string | null
}

interface CheckoutData {
  readonly id?: string
  readonly url?: string
}

interface PixData {
  readonly id?: string
  readonly brCode?: string
  readonly brCodeBase64?: string
}

export function AbacatePayProvider(opts: AbacatePayProviderOptions): PixCapableProvider {
  if (typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
    throw new TypeError('AbacatePayProvider requires { apiKey } — a non-empty AbacatePay API key')
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const doFetch: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init))

  async function post<T>(path: string, body: unknown, code: string): Promise<T> {
    let res: Response
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (cause) {
      // A transport failure, not a refusal: the request never reached a decision.
      throw new PaymentProviderError(
        PROVIDER,
        'network_error',
        `Could not reach AbacatePay at ${baseUrl}${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      )
    }

    const text = await res.text()
    let envelope: Envelope<T>
    try {
      envelope = JSON.parse(text) as Envelope<T>
    } catch {
      throw new PaymentProviderError(
        PROVIDER,
        code,
        `AbacatePay returned HTTP ${res.status} with a body that is not JSON: ${text.slice(0, 200)}`,
      )
    }

    // See the file docstring: an error can arrive alongside HTTP 200, so the
    // status alone is not the verdict.
    if (!res.ok || (envelope.error !== null && envelope.error !== undefined)) {
      throw new PaymentProviderError(
        PROVIDER,
        code,
        `AbacatePay refused the request (HTTP ${res.status}): ${envelope.error ?? 'no error message returned'}`,
      )
    }
    if (envelope.data === undefined || envelope.data === null) {
      throw new PaymentProviderError(
        PROVIDER,
        code,
        `AbacatePay answered HTTP ${res.status} with success but no data object.`,
      )
    }
    return envelope.data
  }

  return definePaymentProvider({
    name: PROVIDER,

    async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
      if (input.currency !== undefined && input.currency.toUpperCase() !== 'BRL') {
        throw new PaymentProviderError(
          PROVIDER,
          'unsupported_currency',
          `AbacatePay settles in BRL only; ${input.currency} was requested. Route this charge to a provider that supports it rather than letting the amount be reinterpreted.`,
        )
      }
      if (input.items.length === 0) {
        throw new PaymentProviderError(
          PROVIDER,
          'empty_checkout',
          'AbacatePay requires at least one item — `items` is the only mandatory field on /checkouts/create.',
        )
      }

      // `idempotencyKey` is intentionally absent from this payload. See point 3
      // of the file docstring.
      const payload = {
        items: input.items.map((i) => ({ id: i.ref, quantity: i.quantity })),
        ...(input.successUrl !== undefined ? { completionUrl: input.successUrl } : {}),
        ...(input.cancelUrl !== undefined ? { returnUrl: input.cancelUrl } : {}),
        ...(input.customerRef !== undefined ? { customerId: input.customerRef } : {}),
        ...(input.metadata !== undefined ? { metadata: { ...input.metadata } } : {}),
      }

      const data = await post<CheckoutData>('/checkouts/create', payload, 'checkout_failed')
      if (typeof data.url !== 'string' || data.url.length === 0) {
        throw new PaymentProviderError(
          PROVIDER,
          'missing_checkout_url',
          'AbacatePay created a checkout without a url. There is nowhere to send the customer, so this cannot be reported as a success.',
        )
      }
      return {
        id: typeof data.id === 'string' ? data.id : '',
        url: data.url,
        provider: PROVIDER,
        raw: data,
      }
    },

    async createPixCharge(input: PixChargeInput): Promise<PixChargeResult> {
      if (!Number.isInteger(input.amountInCents) || input.amountInCents <= 0) {
        throw new PaymentProviderError(
          PROVIDER,
          'invalid_amount',
          `amountInCents must be a positive integer number of centavos; received ${String(input.amountInCents)}.`,
        )
      }
      const payload = {
        method: 'PIX',
        data: {
          amount: input.amountInCents,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.expiresInSeconds !== undefined ? { expiresIn: input.expiresInSeconds } : {}),
          ...(input.customer !== undefined ? { customer: { ...input.customer } } : {}),
          ...(input.metadata !== undefined ? { metadata: { ...input.metadata } } : {}),
        },
      }

      const data = await post<PixData>('/transparents/create', payload, 'pix_charge_failed')
      if (typeof data.brCode !== 'string' || data.brCode.length === 0) {
        throw new PaymentProviderError(
          PROVIDER,
          'missing_br_code',
          'AbacatePay created a PIX charge without a brCode. Nothing can be paid without the copy-and-paste payload.',
        )
      }
      return {
        id: typeof data.id === 'string' ? data.id : '',
        brCode: data.brCode,
        brCodeBase64: typeof data.brCodeBase64 === 'string' ? data.brCodeBase64 : '',
        provider: PROVIDER,
        raw: data,
      }
    },

    // `async` is load-bearing, not stylistic — see the note in providers/stripe.ts.
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
          'AbacatePayProvider needs { webhookSecret } to verify webhooks — the secret you set when creating the webhook, which arrives as the ?webhookSecret= query parameter.',
        )
      }
      if (req.url === undefined || req.url.length === 0) {
        // Failing here rather than falling back to the signature: the signature
        // key may be unset, and if it is, accepting without the query secret
        // would accept anything at all.
        throw new WebhookSignatureError(
          PROVIDER,
          'WebhookRequest.url is required for AbacatePay — its per-merchant secret travels in the query string, so without the URL there is nothing to check it against.',
        )
      }

      let received: string | null
      try {
        received = new URL(req.url).searchParams.get('webhookSecret')
      } catch {
        throw new WebhookSignatureError(
          PROVIDER,
          `WebhookRequest.url is not a parseable absolute URL: ${req.url.slice(0, 120)}`,
        )
      }
      if (received === null || !constantTimeEquals(received, opts.webhookSecret)) {
        throw new WebhookSignatureError(
          PROVIDER,
          'The ?webhookSecret= query parameter is missing or does not match the configured secret.',
        )
      }

      if (opts.signatureKey !== undefined && opts.signatureKey.length > 0) {
        const header = req.headers['x-webhook-signature'] ?? req.headers['X-Webhook-Signature']
        if (header === undefined || header.length === 0) {
          throw new WebhookSignatureError(
            PROVIDER,
            'signatureKey is configured but the request carries no X-Webhook-Signature header.',
          )
        }
        const expected = createHmac('sha256', opts.signatureKey)
          .update(Buffer.from(req.rawBody, 'utf8'))
          .digest('base64')
        if (!constantTimeEquals(expected, header)) {
          throw new WebhookSignatureError(
            PROVIDER,
            'X-Webhook-Signature does not match an HMAC-SHA256 of the raw body under the configured signatureKey.',
          )
        }
      }

      let parsed: { id?: unknown; event?: unknown }
      try {
        parsed = JSON.parse(req.rawBody) as { id?: unknown; event?: unknown }
      } catch (cause) {
        throw new PaymentProviderError(
          PROVIDER,
          'malformed_webhook_body',
          'Webhook body passed verification but is not valid JSON.',
          cause,
        )
      }

      const providerEventType = typeof parsed.event === 'string' ? parsed.event : ''
      return {
        type: EVENT_MAP[providerEventType] ?? 'unknown',
        id: typeof parsed.id === 'string' ? parsed.id : '',
        providerEventType,
        provider: PROVIDER,
        raw: parsed,
      }
    },
  })
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * `timingSafeEqual` throws on a length mismatch, so the length is checked
 * first — that leak is unavoidable and harmless next to comparing byte by byte
 * with `===`, which leaks the position of the first difference and lets an
 * attacker recover a secret one character at a time.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
