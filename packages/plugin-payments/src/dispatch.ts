/**
 * Provider-neutral webhook handling: verify, deduplicate, dispatch.
 *
 * The Stripe surface has had this since 0.1 (`processWebhook`). Without the
 * neutral equivalent, adding AbacatePay would have shipped a provider whose
 * webhooks had no idempotency at all, and a second provider that is worse than
 * the first at the thing that actually loses money — a payment processed twice.
 *
 * Handlers key off {@link PaymentEventType}, the normalised set. A handler that
 * needs a provider's own event name reads `event.providerEventType`, and one
 * that needs the untouched payload reads `event.raw`; neither is discarded.
 */

import { HandlerRegistry } from './handler-registry.js'
import type { IdempotencyStore } from './idempotency-store.js'
import {
  type DispatchOutcome,
  runIdempotently,
  type SanitizedWebhookError,
} from './idempotent-dispatch.js'
import {
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
  WebhookSignatureError,
  type WebhookRequest,
} from './provider-types.js'

export type { SanitizedWebhookError }

/** A handler bound to one normalised event type. */
export interface PaymentEventHandler<T extends PaymentEventType = PaymentEventType> {
  readonly eventType: T
  readonly handle: (event: PaymentEvent) => Promise<void>
}

/**
 * Declare a handler for a normalised payment event.
 *
 * ```ts
 * const onPaid = definePaymentWebhook('checkout.completed', async (event) => {
 *   await fulfil(event.id, event.provider)
 * })
 * ```
 */
export function definePaymentWebhook<T extends PaymentEventType>(
  eventType: T,
  handle: (event: PaymentEvent) => Promise<void>,
): PaymentEventHandler<T> {
  return { eventType, handle }
}

/**
 * Routes normalised events to handlers.
 *
 * Same semantics as the Stripe `WebhookRegistry` — LIFO order, unhandled types
 * are a no-op, and every handler runs even when one throws so a single failure
 * cannot silently cancel the rest. All errors surface together as an
 * `AggregateError`.
 */
export class PaymentEventRegistry extends HandlerRegistry<PaymentEvent> {
  override register<T extends PaymentEventType>(handler: PaymentEventHandler<T>): void {
    super.register(handler)
  }

  override hasHandlersFor(eventType: PaymentEventType): boolean {
    return super.hasHandlersFor(eventType)
  }
}

/**
 * The outcome of handling one inbound webhook.
 *
 * `signature_invalid` is a value here, not an exception, so the HTTP layer can map it to a 401
 * without a try/catch — an unverifiable signature is an expected thing to receive on a public
 * endpoint, not an exceptional one.
 */
export type PaymentWebhookResult =
  | DispatchOutcome
  | { status: 'signature_invalid'; provider: string; message: string }

/**
 * Verify an inbound webhook with `provider`, deduplicate it, and dispatch.
 *
 * `signature_invalid` is returned rather than thrown so the HTTP layer maps it
 * to 401/400 without a try/catch. Anything else the provider throws — a
 * malformed body after a valid signature, for instance — propagates, because
 * turning an unrecognised failure into a 400 would tell the provider to stop
 * retrying something that might be our bug.
 */
export async function processPaymentWebhook(opts: {
  provider: PaymentProvider
  request: WebhookRequest
  registry: PaymentEventRegistry
  store: IdempotencyStore
  /**
   * Overrides `provider.name` when namespacing the event id in the store.
   *
   * Two gateways can share a `name` — two Stripe accounts, for a marketplace or
   * separate legal entities — and then `provider.name` namespaces both to
   * "stripe". Stripe's own ids happen to be globally unique so nothing collides
   * there today, but that is a property of one gateway rather than of this
   * contract. The plugin passes its routing key, which is unique by
   * construction.
   */
  namespace?: string
}): Promise<PaymentWebhookResult> {
  let event: PaymentEvent
  try {
    event = await opts.provider.verifyWebhook(opts.request)
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      return { status: 'signature_invalid', provider: err.provider, message: err.message }
    }
    throw err
  }

  // Event ids are unique per provider but nothing guarantees they are unique
  // ACROSS providers, and one store may serve several. Namespacing here costs
  // one string concat and removes a collision that would look like a duplicate
  // and silently drop a real payment.
  // Namespaced on purpose: the Stripe-typed `processWebhook` stores the bare `event.id`. Keys
  // already recorded by apps on either path must keep matching, or an upgrade mid-retry would
  // re-run an event under the other key. Do not unify without migrating stored keys.
  const namespace = opts.namespace ?? event.provider
  return runIdempotently({
    eventId: `${namespace}:${event.id}`,
    store: opts.store,
    dispatch: () => opts.registry.dispatch(event),
    logLabel: `[plugin-payments/${namespace}]`,
  })
}
