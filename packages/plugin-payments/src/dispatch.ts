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
export class PaymentEventRegistry {
  private readonly handlers = new Map<string, PaymentEventHandler[]>()

  register<T extends PaymentEventType>(handler: PaymentEventHandler<T>): void {
    const bucket = this.handlers.get(handler.eventType) ?? []
    bucket.push(handler)
    this.handlers.set(handler.eventType, bucket)
  }

  async dispatch(event: PaymentEvent): Promise<void> {
    const bucket = this.handlers.get(event.type)
    if (bucket === undefined || bucket.length === 0) return
    const errors: unknown[] = []
    for (let i = bucket.length - 1; i >= 0; i--) {
      const handler = bucket[i]
      if (handler === undefined) continue
      try {
        await handler.handle(event)
      } catch (err) {
        errors.push(err)
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} webhook handler(s) failed for event "${event.type}".`,
      )
    }
  }

  hasHandlersFor(eventType: PaymentEventType): boolean {
    const bucket = this.handlers.get(eventType)
    return bucket !== undefined && bucket.length > 0
  }
}

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
  return runIdempotently({
    eventId: `${event.provider}:${event.id}`,
    store: opts.store,
    dispatch: () => opts.registry.dispatch(event),
    logLabel: `[plugin-payments/${event.provider}]`,
  })
}
