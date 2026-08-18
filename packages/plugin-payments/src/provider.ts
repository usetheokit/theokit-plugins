/**
 * Provider registration and capability detection.
 *
 * Mirrors `defineEmailProvider` / `defineRealtimeProvider`: validate the shape at
 * WIRING time so a malformed provider crashes at boot rather than on the first
 * customer's checkout. A payment provider that fails late fails while somebody
 * is trying to pay.
 */

import {
  type PartialRefundCapableProvider,
  type PaymentProvider,
  type PixCapableProvider,
  type SubscriptionCapableProvider,
} from './provider-types.js'

/**
 * Register a payment provider, validating the contract up front.
 *
 * Returns the same object — this is a checkpoint, not a wrapper, so nothing is
 * hidden behind a proxy and a stack trace still points at the implementation.
 */
export function definePaymentProvider<T extends PaymentProvider>(impl: T): T {
  if (impl === null || typeof impl !== 'object') {
    throw new TypeError('definePaymentProvider: provider implementation is required')
  }
  if (typeof impl.name !== 'string' || impl.name.length === 0) {
    throw new TypeError('definePaymentProvider: impl.name must be a non-empty string')
  }
  if (typeof impl.createCheckout !== 'function') {
    throw new TypeError('definePaymentProvider: impl.createCheckout must be a function')
  }
  if (typeof impl.verifyWebhook !== 'function') {
    throw new TypeError('definePaymentProvider: impl.verifyWebhook must be a function')
  }
  if (typeof impl.retrieveCheckout !== 'function') {
    throw new TypeError('definePaymentProvider: impl.retrieveCheckout must be a function')
  }
  if (typeof impl.refund !== 'function') {
    throw new TypeError('definePaymentProvider: impl.refund must be a function')
  }
  // Half a PIX implementation is worse than none: the guard below would report
  // the provider as capable and the call would fail at runtime.
  const pix = (impl as Partial<PixCapableProvider>).createPixCharge
  if (pix !== undefined && typeof pix !== 'function') {
    throw new TypeError(
      'definePaymentProvider: impl.createPixCharge must be a function when present',
    )
  }
  const partial = (impl as Partial<PartialRefundCapableProvider>).refundPartial
  if (partial !== undefined && typeof partial !== 'function') {
    throw new TypeError('definePaymentProvider: impl.refundPartial must be a function when present')
  }
  return impl
}

/**
 * Narrow a provider to one that can issue inline PIX charges.
 *
 * A type guard rather than an optional method, so the compiler stops a consumer
 * from calling `createPixCharge` on Stripe. Checking a capability is a deliberate
 * step here — the alternative is every provider carrying a method that throws.
 *
 * ```ts
 * if (supportsPix(provider)) {
 *   const { brCode } = await provider.createPixCharge({ amountInCents: 500 })
 * }
 * ```
 */
export function supportsPix(provider: PaymentProvider): provider is PixCapableProvider {
  return typeof (provider as Partial<PixCapableProvider>).createPixCharge === 'function'
}

/**
 * Narrow a provider to one that can refund less than the full amount.
 *
 * A guard rather than an optional method, so the compiler stops a caller from
 * asking AbacatePay for a partial refund — it refunds integrally and documents
 * that it does. Same shape as {@link supportsPix}, deliberately: two
 * capabilities detected two different ways would be one convention too many.
 *
 * ```ts
 * if (supportsPartialRefund(provider)) {
 *   await provider.refundPartial({ reference: id, amountInCents: 400 })
 * }
 * ```
 */
export function supportsPartialRefund(
  provider: PaymentProvider,
): provider is PartialRefundCapableProvider {
  return typeof (provider as Partial<PartialRefundCapableProvider>).refundPartial === 'function'
}

/**
 * Narrow a provider to one that can end a recurring charge.
 *
 * See {@link SubscriptionCapableProvider} for why cancelling is a capability
 * while starting a subscription is a field on the input.
 */
export function supportsSubscriptions(
  provider: PaymentProvider,
): provider is SubscriptionCapableProvider {
  return typeof (provider as Partial<SubscriptionCapableProvider>).cancelSubscription === 'function'
}
