/**
 * @theokit/plugin-payments — the provider-neutral surface.
 *
 * Nothing here imports a gateway SDK. Code written against this entry point
 * works with Stripe, with AbacatePay, and with a provider you write yourself,
 * and it can switch between them without a rewrite:
 *
 * ```ts
 * import { processPaymentWebhook, PaymentEventRegistry, definePaymentWebhook,
 *          createMemoryStore, supportsPix } from '@theokit/plugin-payments'
 * import { StripeProvider } from '@theokit/plugin-payments/stripe'
 * import { AbacatePayProvider } from '@theokit/plugin-payments/abacatepay'
 * ```
 *
 * The gateways live behind subpaths on purpose. A Brazilian shop that only
 * takes PIX should not have Stripe's SDK types in its build, and neither
 * peer dependency is required unless the matching subpath is imported.
 *
 * Anything a single gateway can do that the others cannot stays out of
 * {@link PaymentProvider} and is reached through a capability guard —
 * {@link supportsPix} is the first. See `provider-types.ts` for why.
 *
 * @public
 */

export {
  type CheckoutInput,
  type CheckoutItem,
  type CheckoutMode,
  type CheckoutResult,
  type CheckoutStatus,
  type PartialRefundCapableProvider,
  type PartialRefundInput,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
  PaymentProviderError,
  type PaymentStatus,
  type PixCapableProvider,
  type PixChargeInput,
  type PixChargeResult,
  type RefundInput,
  type RefundResult,
  type SubscriptionCapableProvider,
  type SubscriptionStatus,
  type WebhookRequest,
  WebhookSignatureError,
} from './provider-types.js'

export {
  definePaymentProvider,
  supportsPartialRefund,
  supportsPix,
  supportsSubscriptions,
} from './provider.js'

export {
  type MultiProviderPaymentsOptions,
  type MultiProviderPaymentsPlugin,
  payments,
} from './plugin.js'

export {
  definePaymentWebhook,
  PaymentEventRegistry,
  type PaymentEventHandler,
  type PaymentWebhookResult,
  processPaymentWebhook,
} from './dispatch.js'

export { type DispatchOutcome, type SanitizedWebhookError } from './idempotent-dispatch.js'

// Idempotency is a property of webhook delivery, not of any one gateway — every
// provider here retries, so the store belongs on the neutral surface.
export {
  createMemoryStore,
  createOrmStore,
  type IdempotencyRepository,
  type IdempotencyStore,
} from './idempotency-store.js'

// Zero-decimal-currency arithmetic (JPY has no cents, BRL and USD do). Named for
// Stripe because that is whose table it implements, but the rounding rule is the
// ISO 4217 one and applies to any gateway that takes amounts in minor units.
export { formatAmountForDisplay, formatAmountForStripe } from './currency.js'
