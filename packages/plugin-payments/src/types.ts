/**
 * @theokit/plugin-payments — runtime types.
 *
 * Per plan p6-plugin-payments v1.0. TheoPlugin shape is structurally declared
 * to keep peerDep on `theokit` minimal — at runtime the plugin runner accepts
 * any object with this shape via duck-typing.
 */

import type Stripe from 'stripe'
import type { ResolvedPaymentsOptions } from './options.js'

/** Minimal app surface the plugin's `register()` needs. */
export interface TheoPluginApp {
  /** Register a server route (used for /api/payments/webhook handler if consumer opts in). */
  registerRoute?(path: string, method: string, handler: unknown): void
  /** Register a test whether a server route is already registered. */
  hasRoute?(path: string, method: string): boolean
}

/** Stripe webhook handler descriptor returned by `defineStripeWebhook`. */
export interface StripeWebhookHandler<T extends Stripe.Event['type'] = Stripe.Event['type']> {
  readonly eventType: T
  readonly handle: (event: Extract<Stripe.Event, { type: T }>) => Promise<void>
}

/**
 * The plugin shape this package emits.
 */
export interface PaymentsPlugin {
  readonly name: '@theokit/plugin-payments'
  readonly kind: 'payments'
  readonly options: ResolvedPaymentsOptions
  /** Lazy singleton Stripe client. Throws actionable error if secretKey missing. */
  getStripeClient(): Stripe
  /** Register the plugin into a theokit app. */
  register(app: TheoPluginApp): void
}
