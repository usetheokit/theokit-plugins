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

/**
 * One-off charge, or the start of a recurring one.
 *
 * A field on the input rather than a capability interface, unlike PIX — both
 * providers do subscriptions, through the same shape (a hosted checkout that
 * returns a redirect URL), so the criterion that split PIX out does not apply.
 * What differs is plumbing the provider hides: Stripe passes `mode` to the same
 * endpoint, AbacatePay posts to `/subscriptions/create` instead.
 *
 * What does NOT differ, and is therefore not modelled here: the recurrence
 * itself. Both providers read the interval off the product/price registered in
 * their own catalogue — Stripe from the price's `recurring`, AbacatePay from the
 * product's `cycle`. Accepting an interval on this input would invite a caller
 * to pass one that contradicts the catalogue, and the provider would have to
 * silently ignore it.
 */
export type CheckoutMode = 'payment' | 'subscription'

/**
 * What every provider needs to open a checkout, in provider-neutral terms.
 *
 * `mode` is not a hint: providers reject a mismatch between it and the referenced price rather than
 * reinterpreting it, so a recurring price in `'payment'` mode fails loudly at the gateway instead of
 * quietly charging once.
 */
export interface CheckoutInput {
  readonly items: readonly CheckoutItem[]
  /**
   * Defaults to `'payment'`. Providers reject a mismatch between the mode and
   * the referenced price/product rather than reinterpreting it — measured
   * 2026-08-18, Stripe answers "You specified `payment` mode but passed a
   * recurring price" and the symmetric "You must provide at least one recurring
   * price in `subscription` mode".
   */
  readonly mode?: CheckoutMode
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

/**
 * A successfully opened checkout.
 *
 * `id` is what correlates the later webhook back to this session, and `provider` is what lets a
 * multi-provider app route that webhook to the right verifier. `raw` carries the untouched provider
 * response so nothing this contract omits is lost.
 */
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

/**
 * One inbound provider event, normalised.
 *
 * `id` is the provider's event id and is what a consumer deduplicates on — gateways retry delivery,
 * so the same event arriving twice is expected operation, not a fault.
 */
export interface PaymentEvent {
  readonly type: PaymentEventType
  /** Provider event id, for consumer-side deduplication. */
  readonly id: string
  /** The provider's own event name, never discarded. */
  readonly providerEventType: string
  readonly provider: string
  readonly raw: unknown
}

/**
 * Where a charge stands, normalised.
 *
 * The set both providers can actually report, and nothing aspirational:
 * AbacatePay returns PENDING / PAID / EXPIRED / CANCELLED / REFUNDED verbatim,
 * and Stripe's session carries `status` plus `payment_status`, with the refund
 * state one expansion away.
 */
export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'refunded'
  | 'failed'
  | 'unknown'

/**
 * A checkout read back from the provider, for polling or reconciliation.
 *
 * Amounts are optional because not every provider reports them on every status, and absent is not
 * zero: `amountRefundedInCents` undefined means "not reported", while `0` means "nothing refunded".
 */
export interface CheckoutStatus {
  readonly id: string
  readonly status: PaymentStatus
  readonly provider: string
  /** Smallest currency unit, when the provider reports one. */
  readonly amountInCents?: number
  /** Amount already refunded, in the same unit. `0` when nothing was. */
  readonly amountRefundedInCents?: number
  readonly currency?: string
  readonly raw: unknown
}

/**
 * A full refund of a completed charge.
 *
 * Partial refunds are NOT here: AbacatePay refunds integrally and says so
 * ("reembolsos parciais não são suportados"), so a partial amount on the base
 * contract would be a field one implementation has to refuse. It lives on
 * {@link PartialRefundCapableProvider}, reached through `supportsPartialRefund`
 * — the same treatment PIX gets, for the same reason.
 */
export interface RefundInput {
  /**
   * What to refund: the `id` from a {@link CheckoutResult}, or a provider-native
   * payment reference. Stripe accepts `cs_…` (resolved to its payment intent),
   * `pi_…` or `ch_…`; AbacatePay accepts `bill_…`, `char_…`, `pix_char_…` or
   * `card_…`.
   */
  readonly reference: string
  readonly reason?: string
  /** Honoured by providers that have a request-level mechanism. */
  readonly idempotencyKey?: string
}

/**
 * A refund for less than the full amount.
 *
 * Separate from `RefundInput` because not every provider supports it; reach it through the
 * `supportsPartialRefund` guard rather than assuming, so an unsupported provider fails at the type
 * level instead of at the gateway.
 */
export interface PartialRefundInput extends RefundInput {
  /** Smallest currency unit. Must be at most what remains refundable. */
  readonly amountInCents: number
}

/**
 * A refund the provider accepted.
 *
 * `amountInCents` is optional because some providers acknowledge without echoing the amount;
 * treating its absence as zero would misreport a refund that did happen.
 */
export interface RefundResult {
  readonly id: string
  readonly provider: string
  /** What was actually refunded, when the provider reports it. */
  readonly amountInCents?: number
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
  /**
   * Where a charge stands, asked directly rather than waited for.
   *
   * Not a convenience. Webhook delivery is at-least-once and at-least-once is
   * not at-least-one: a dropped delivery, a deploy during the retry window, or
   * an endpoint that 500s past the provider's give-up point all end with a paid
   * customer and an order nobody fulfilled. Reconciliation needs a way to ASK,
   * and a payments contract without one obliges every consumer to reach around
   * it to the gateway SDK.
   */
  retrieveCheckout(reference: string): Promise<CheckoutStatus>
  /** Refund a completed charge in full. See {@link RefundInput}. */
  refund(input: RefundInput): Promise<RefundResult>
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

/**
 * A PIX charge, as the Brazilian instant-payment scheme expects it to be presented.
 *
 * Both encodings of the same code are returned: `brCode` for a copy-and-paste field, and
 * `brCodeBase64` so a UI can show the QR without pulling in a QR library. PIX is reachable only
 * through the `supportsPix` capability guard — most providers do not serve it.
 */
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

/**
 * Providers that can refund less than the full amount.
 *
 * Separate for the same reason PIX is — see {@link RefundInput}. Reach it
 * through `supportsPartialRefund`, never by casting.
 */
export interface PartialRefundCapableProvider extends PaymentProvider {
  refundPartial(input: PartialRefundInput): Promise<RefundResult>
}

/**
 * Where a subscription stands after an operation on it.
 *
 * Deliberately three values. Both providers report far more — Stripe has
 * `trialing`, `past_due`, `incomplete`, `unpaid`; AbacatePay has `PENDING`,
 * `EXPIRED`, `PAID` — and normalising those into one enum would mean deciding,
 * for every consumer, whether `past_due` is active. It is not our call to make.
 * `raw` carries the provider's own answer for anyone who needs it.
 */
export interface SubscriptionStatus {
  readonly id: string
  readonly status: 'active' | 'cancelled' | 'unknown'
  readonly provider: string
  readonly raw: unknown
}

/**
 * Providers that can end a recurring charge.
 *
 * A capability rather than a base method, while `mode: 'subscription'` is a
 * plain field on {@link CheckoutInput} — and the line between them is worth
 * stating, because it looks arbitrary until you see it:
 *
 *   a VALUE a provider cannot serve is validated and refused (AbacatePay
 *   rejects a non-BRL currency, and would reject a subscription mode it did not
 *   support), which is a runtime answer about one call;
 *
 *   a METHOD a provider does not have is a capability, because its absence has
 *   to be visible to the COMPILER — otherwise every consumer writes a call that
 *   type-checks and throws.
 *
 * Reach it through `supportsSubscriptions`, never by casting.
 */
export interface SubscriptionCapableProvider extends PaymentProvider {
  /**
   * End a subscription immediately. Irreversible on both providers.
   *
   * `reference` takes the subscription's own id, or the id of the checkout that
   * started it — providers resolve the second to the first, because the caller
   * usually kept the checkout id and never saw the subscription come into being.
   */
  cancelSubscription(reference: string): Promise<SubscriptionStatus>
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
