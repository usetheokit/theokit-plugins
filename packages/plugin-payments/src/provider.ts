/**
 * Provider registration and capability detection.
 *
 * Mirrors `defineEmailProvider` / `defineRealtimeProvider`: validate the shape at
 * WIRING time so a malformed provider crashes at boot rather than on the first
 * customer's checkout. A payment provider that fails late fails while somebody
 * is trying to pay.
 */

import { type PaymentProvider, type PixCapableProvider } from './provider-types.js'

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
  // Half a PIX implementation is worse than none: the guard below would report
  // the provider as capable and the call would fail at runtime.
  const pix = (impl as Partial<PixCapableProvider>).createPixCharge
  if (pix !== undefined && typeof pix !== 'function') {
    throw new TypeError(
      'definePaymentProvider: impl.createPixCharge must be a function when present',
    )
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
