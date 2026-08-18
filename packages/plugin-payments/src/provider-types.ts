/**
 * The provider contract — the neutral surface every payment gateway implements.
 *
 * Modelled on what Stripe and AbacatePay BOTH actually do, measured from their
 * APIs rather than generalised from one of them:
 *
 *   Stripe       checkout.sessions.create  -> session.url (redirect) + id
 *   AbacatePay   POST /checkouts/create    -> data.url  (redirect) + id
 *
 * That intersection — create a hosted checkout, get a redirect URL back, and
 * verify an inbound webhook — is the whole base contract. Everything a single
 * provider can do and the other cannot stays OUT of it, because an interface
 * that describes capabilities half its implementations lack forces those
 * implementations to lie (throwing `NotImplemented`, returning null), and the
 * consumer learns nothing from the type.
 *
 * PIX is the concrete case: AbacatePay serves an inline QR payload
 * (`POST /transparents/create` -> `brCode` + `brCodeBase64`) and Stripe has no
 * equivalent. It lives in {@link PixCapableProvider}, reachable through the
 * {@link supportsPix} guard, so Stripe never pretends and AbacatePay is never
 * amputated to the common denominator.
 *
 * Currency is deliberately explicit per call rather than provider-global:
 * Stripe is multi-currency, AbacatePay is BRL-only, and a provider that cannot
 * honour the requested currency must say so instead of silently converting.
 */

/** A line on a checkout: a reference the PROVIDER understands, plus how many. */
export interface CheckoutItem {
  /**
   * Provider-side identifier of the thing being sold — a Stripe `price` id, an
   * AbacatePay `product` id. Deliberately opaque: normalising these across
   * providers would mean owning a product catalogue, which this plugin does not.
   */
  readonly ref: string
  readonly quantity: number
}

export interface CheckoutInput {
  readonly items: readonly CheckoutItem[]
  /** ISO 4217, uppercase. Providers reject what they cannot serve. */
  readonly currency?: string
  /** Where the provider sends the customer after success. */
  readonly successUrl?: string
  /** Where the provider sends the customer if they abandon. */
  readonly cancelUrl?: string
  /** Provider-side customer identifier, when the caller already has one. */
  readonly customerRef?: string
  /**
   * Caller-stable key for safe retries. Each provider maps it to its own
   * mechanism; a provider without one must document that it ignores this.
   */
  readonly idempotencyKey?: string
  readonly metadata?: Readonly<Record<string, string>>
}

export interface CheckoutResult {
  /** Provider-assigned id, for correlating the later webhook. */
  readonly id: string
  /** Where to send the customer. Both supported providers return one. */
  readonly url: string
  /** Which provider produced this, so a multi-provider app can route back. */
  readonly provider: string
  /** Untouched provider response, for anything this contract does not model. */
  readonly raw: unknown
}

/**
 * Normalised webhook outcome.
 *
 * `type` is the small set worth branching on; `providerEventType` keeps the
 * original string, because collapsing an unknown event into a bucket loses the
 * only information a consumer could act on. Anything unrecognised arrives as
 * `unknown` WITH its original name rather than being dropped.
 */
export type PaymentEventType =
  | 'checkout.completed'
  | 'checkout.expired'
  | 'payment.refunded'
  | 'payment.disputed'
  | 'payment.failed'
  | 'unknown'

export interface PaymentEvent {
  readonly type: PaymentEventType
  /** Provider event id, for consumer-side deduplication. */
  readonly id: string
  /** The provider's own event name, never discarded. */
  readonly providerEventType: string
  readonly provider: string
  readonly raw: unknown
}

/** What a provider needs to verify an inbound webhook. */
export interface WebhookRequest {
  /**
   * The EXACT bytes received. Every HMAC scheme signs the raw body, so a body
   * that has been parsed and re-serialised will fail verification even when the
   * payload is semantically identical.
   */
  readonly rawBody: string
  readonly headers: Readonly<Record<string, string | undefined>>
  /**
   * The full request URL, when the runtime has it.
   *
   * Not every gateway puts its shared secret in a header. AbacatePay's
   * per-merchant secret arrives as a `?webhookSecret=` query parameter — its
   * HMAC key is a constant published in its own public documentation, so the
   * query secret is the part an attacker cannot guess and the signature alone
   * proves only that the body was not altered. Stripe ignores this field.
   */
  readonly url?: string
}

/** The contract. Everything here, both supported providers do. */
export interface PaymentProvider {
  /** Stable identifier, e.g. "stripe", "abacatepay". */
  readonly name: string
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>
  /** Verifies authenticity and normalises. Throws on a bad signature. */
  verifyWebhook(req: WebhookRequest): Promise<PaymentEvent>
}

/** Inline PIX charge — AbacatePay's `POST /transparents/create`. */
export interface PixChargeInput {
  /** Smallest currency unit (centavos). */
  readonly amountInCents: number
  readonly description?: string
  /** Seconds until the code stops being payable. */
  readonly expiresInSeconds?: number
  readonly customer?: {
    readonly name?: string
    readonly email?: string
    readonly taxId?: string
    readonly cellphone?: string
  }
  readonly metadata?: Readonly<Record<string, string>>
}

export interface PixChargeResult {
  readonly id: string
  /** Copy-and-paste PIX payload (BR Code / EMV). */
  readonly brCode: string
  /** Same code as a base64 PNG, for rendering without a QR library. */
  readonly brCodeBase64: string
  readonly provider: string
  readonly raw: unknown
}

/**
 * Providers that can issue an inline PIX charge.
 *
 * Separate from {@link PaymentProvider} on purpose — see the file docstring.
 * Reach it through {@link supportsPix}, never by casting.
 */
export interface PixCapableProvider extends PaymentProvider {
  createPixCharge(input: PixChargeInput): Promise<PixChargeResult>
}

/** Raised when a provider refuses or fails a call. */
export class PaymentProviderError extends Error {
  override readonly name = 'PaymentProviderError'
  readonly provider: string
  readonly code: string
  override readonly cause?: unknown

  constructor(provider: string, code: string, message: string, cause?: unknown) {
    super(message)
    this.provider = provider
    this.code = code
    this.cause = cause
  }
}

/** Raised when an inbound webhook fails authenticity verification. */
export class WebhookSignatureError extends Error {
  override readonly name = 'WebhookSignatureError'
  readonly provider: string

  constructor(provider: string, message: string) {
    super(message)
    this.provider = provider
  }
}
