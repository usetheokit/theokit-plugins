/**
 * @theokit/plugin-payments — runtime types.
 *
 * The plugin shape comes from the framework, not from here. A `TheoPluginApp`
 * used to be declared locally, justified as "keeping the peerDep minimal" — it
 * declared `registerRoute` and `hasRoute`, neither of which exists on `TheoApp`,
 * and type-checked anyway because TypeScript is structural and the parameter was
 * never used (#42). `import type` is erased at build, so importing the real
 * contract costs nothing at runtime and the compiler checks it.
 */

import type Stripe from 'stripe'
import type { TheoApp, TheoPlugin } from 'theokit/server'

import type { ResolvedPaymentsOptions } from './options.js'

export type { TheoApp, TheoPlugin }

/** Stripe webhook handler descriptor returned by `defineStripeWebhook`. */
export interface StripeWebhookHandler<T extends Stripe.Event['type'] = Stripe.Event['type']> {
  readonly eventType: T
  readonly handle: (event: Extract<Stripe.Event, { type: T }>) => Promise<void>
}

/**
 * The plugin shape this package emits.
 */
export interface PaymentsPlugin extends TheoPlugin {
  readonly name: '@theokit/plugin-payments'
  readonly kind: 'payments'
  readonly options: ResolvedPaymentsOptions
  /** Lazy singleton Stripe client. Throws actionable error if secretKey missing. */
  getStripeClient(): Stripe
  /** Publish the Stripe client on `ctx.stripe`. See `stripePayments()`. */
  register(app: TheoApp): void
}
