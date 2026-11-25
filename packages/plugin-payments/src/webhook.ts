/**
 * @theokit/plugin-payments — typed webhook dispatcher.
 *
 * Per plan p6-plugin-payments v1.0 § Phase 2 / T2.1 + T2.2.
 * Blueprint ADR D1 + Q2 — `defineStripeWebhook(eventType, handler)` provides
 * type-safe `Stripe.Event` narrowing via discriminated union on `event.type`.
 */

import type Stripe from 'stripe'

import { HandlerRegistry } from './handler-registry.js'
import type { IdempotencyStore } from './idempotency-store.js'
import {
  type DispatchOutcome,
  runIdempotently,
  type SanitizedWebhookError,
} from './idempotent-dispatch.js'
import { verifyStripeSignature } from './stripe-webhook-verifier.js'
import type { StripeWebhookHandler } from './types.js'

/**
 * Error thrown when webhook signature verification fails OR raw-body access
 * is malformed.
 */
export class StripeSignatureError extends Error {
  override readonly name = 'StripeSignatureError'
  constructor(message: string) {
    super(message)
  }
}

/**
 * Define a typed handler for a specific Stripe webhook event type.
 *
 * The handler receives the narrowed `Stripe.Event` variant via
 * `Extract<Stripe.Event, { type: T }>`. Example:
 *
 * ```ts
 * const onCheckoutComplete = defineStripeWebhook(
 *   "checkout.session.completed",
 *   async (event) => {
 *     // event is typed as Stripe.CheckoutSessionCompletedEvent
 *     const session = event.data.object;
 *     console.log(session.customer);
 *   },
 * );
 * ```
 *
 * Register multiple handlers with a `WebhookRegistry` instance.
 *
 * IDEMPOTENCY CONTRACT (EC-3): handlers MUST be idempotent. The dispatcher is
 * exactly-once for a single successful handler, but on a multi-handler partial
 * failure (one handler throws) OR a post-dispatch store error, the whole event
 * is released and a Stripe retry re-invokes the already-succeeded handlers too
 * (at-least-once). Design handlers to tolerate re-execution (e.g. upsert, not
 * blind insert).
 */
export function defineStripeWebhook<T extends Stripe.Event['type']>(
  eventType: T,
  handle: (event: Extract<Stripe.Event, { type: T }>) => Promise<void>,
): StripeWebhookHandler<T> {
  return { eventType, handle }
}

/**
 * Registry for Stripe webhook handlers. Routes incoming `Stripe.Event`
 * objects to matching `defineStripeWebhook` descriptors.
 *
 * Multiple handlers may be registered for the same event type — they run
 * in LIFO order (last registered runs first). Errors in any handler
 * are collected into one `AggregateError` (consumer chooses 500 vs 200).
 *
 * Unhandled event types are NO-OP (no error). This matches Stripe's
 * recommended behavior — respond 200 to acknowledge receipt even when
 * the event type isn't relevant to the consumer's domain.
 */
export class WebhookRegistry extends HandlerRegistry<Stripe.Event> {
  // The public typed shape is variant over `T` (handle accepts narrowed events); the shared
  // registry stores it erased. Safe because dispatch only calls handlers whose eventType matches.
  override register<T extends Stripe.Event['type']>(handler: StripeWebhookHandler<T>): void {
    super.register({
      eventType: handler.eventType,
      handle: handler.handle as (event: Stripe.Event) => Promise<void>,
    })
  }
}

/**
 * Verify a raw webhook body's signature and parse it into a typed `Stripe.Event`.
 *
 * `rawBody` MUST be the unmodified body bytes (string). Consumer's HTTP handler
 * MUST call `await req.text()` (or equivalent) BEFORE any other body access —
 * JSON parsing before signature verification breaks the HMAC.
 *
 * Throws `StripeSignatureError` if the signature is missing or invalid.
 */
export function verifyAndParseWebhook(
  stripe: Stripe,
  rawBody: string,
  signatureHeader: string | undefined,
  webhookSecret: string,
): Stripe.Event {
  const result = verifyStripeSignature(stripe, rawBody, signatureHeader, webhookSecret)
  if (result.ok) return result.event
  if (result.reason === 'missing_header') {
    throw new StripeSignatureError(
      'Missing stripe-signature header. Webhook MUST include the signature in the request headers.',
    )
  }
  const message = result.cause instanceof Error ? result.cause.message : 'Unknown signature error'
  throw new StripeSignatureError(`Webhook signature verification failed: ${message}`)
}

// `SanitizedWebhookError` now lives in ./idempotent-dispatch.js, shared with the
// neutral multi-provider path. Re-exported so the Stripe surface is unchanged.
export type { SanitizedWebhookError }

/**
 * The outcome of the Stripe-typed webhook path.
 *
 * `signature_invalid` is a value, not an exception: an unverifiable signature is an ordinary thing
 * to receive on a public endpoint, and returning it lets the HTTP layer answer 401 without a
 * try/catch around the happy path.
 */
export type WebhookResult = DispatchOutcome | { status: 'signature_invalid'; message: string }

/**
 * High-level webhook handler that combines:
 * - signature verification (`stripe.webhooks.constructEvent`)
 * - idempotency check (`store.markProcessed`)
 * - registry dispatch (route to registered handlers)
 *
 * Returns a discriminated `WebhookResult` so the HTTP layer can map to
 * status codes correctly:
 *   - `ok` (200) — event processed OR duplicate (idempotency)
 *   - `signature_invalid` (400) — reject with error message
 *   - `handler_error` (500) — consumer's handler threw
 */
export async function processWebhook(opts: {
  stripe: Stripe
  rawBody: string
  signatureHeader: string | undefined
  webhookSecret: string
  registry: WebhookRegistry
  store: IdempotencyStore
}): Promise<WebhookResult> {
  let event: Stripe.Event
  try {
    event = verifyAndParseWebhook(
      opts.stripe,
      opts.rawBody,
      opts.signatureHeader,
      opts.webhookSecret,
    )
  } catch (err) {
    if (err instanceof StripeSignatureError) {
      return { status: 'signature_invalid', message: err.message }
    }
    throw err
  }
  return runIdempotently({
    // The bare event id on purpose: the neutral path stores `${namespace}:${event.id}`. Keys
    // already recorded by apps on either path must keep matching, or an upgrade mid-retry would
    // re-run an event under the other key. Do not unify without migrating stored keys.
    eventId: event.id,
    store: opts.store,
    dispatch: () => opts.registry.dispatch(event),
  })
}
