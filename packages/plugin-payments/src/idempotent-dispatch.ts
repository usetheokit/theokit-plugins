/**
 * The claim → dispatch → release cycle, shared by every provider.
 *
 * This was Stripe-only logic inside `processWebhook`. It moved here when
 * AbacatePay arrived, because the reasoning it encodes is not Stripe's — it is
 * what any at-least-once webhook delivery requires:
 *
 *   claim the event id BEFORE dispatch, so two concurrent deliveries of the
 *   same event cannot both run; release the claim if dispatch fails, so the
 *   provider's retry can re-run it; and never let a handler's error text cross
 *   the HTTP boundary, because it may carry keys or customer data.
 *
 * Duplicating that per provider would mean two chances to get the release path
 * wrong, and the release path is the one nobody exercises by hand.
 */

import type { IdempotencyStore } from './idempotency-store.js'

/**
 * A sanitized error surfaced to the HTTP layer. NEVER carries the raw handler
 * error (which may contain PII/secrets, #201) — `code` is a stable control-flow
 * token and `message` is a fixed generic string. The full error is logged
 * server-side (redacted) before this is returned.
 */
export interface SanitizedWebhookError {
  code: string
  message: string
}

/** What happened to one delivery, in terms the HTTP layer can map to a status. */
export type DispatchOutcome =
  | { status: 'ok'; eventId: string; duplicate: boolean }
  | { status: 'handler_error'; eventId: string; error: SanitizedWebhookError }

/**
 * Redact known secret shapes (Stripe keys, basic-auth credentials in URLs) from
 * a value before it is logged. Best-effort defense-in-depth — the primary
 * guarantee is that the raw error never crosses the HTTP boundary at all, and
 * this pattern list only covers shapes we can recognise.
 */
export function redactSecrets(value: unknown): string {
  const text =
    value instanceof AggregateError
      ? `AggregateError: ${value.message} [${value.errors
          .map((e) => (e instanceof Error ? e.message : String(e)))
          .join(' | ')}]`
      : value instanceof Error
        ? `${value.name}: ${value.message}`
        : String(value)
  return text
    .replace(
      /\b(whsec|sk_live|sk_test|pk_live|pk_test|rk_live|rk_test)_[A-Za-z0-9]+/g,
      '$1_***REDACTED***',
    )
    .replace(/\/\/[^:/@\s]+:[^@/\s]+@/g, '//***:***@')
}

/**
 * Run `dispatch` at most once per `eventId`, releasing the claim if it throws.
 *
 * Exactly-once on success. On a partial failure — one handler of several throws
 * — the whole event is released and the provider's retry re-invokes the
 * handlers that already succeeded, so handlers must tolerate re-execution.
 */
export async function runIdempotently(opts: {
  eventId: string
  store: IdempotencyStore
  dispatch: () => Promise<void>
  /** Log prefix, so a multi-provider app can tell the lines apart. */
  logLabel?: string
}): Promise<DispatchOutcome> {
  const label = opts.logLabel ?? '[plugin-payments]'

  const isNew = await opts.store.markProcessed(opts.eventId)
  if (!isNew) {
    return { status: 'ok', eventId: opts.eventId, duplicate: true }
  }

  try {
    await opts.dispatch()
  } catch (error) {
    // #167: release the claim so the retry re-runs the handler. Best-effort —
    // if release itself fails the claim persists (retry would dedupe); log it.
    try {
      await opts.store.release(opts.eventId)
    } catch (releaseError) {
      // #F-dom-pay-5: redact before logging — a release() failure (e.g. a DB
      // error) may carry credentials, same as the handler-error path below.
      console.error(`${label} failed to release idempotency claim after handler error:`, {
        eventId: opts.eventId,
        releaseError: redactSecrets(releaseError),
      })
    }
    // #201: log the FULL error server-side (redacted), expose only a sanitized
    // {code,message} at the HTTP boundary so secrets/PII never leak to the caller.
    console.error(`${label} webhook handler error:`, {
      eventId: opts.eventId,
      error: redactSecrets(error),
    })
    return {
      status: 'handler_error',
      eventId: opts.eventId,
      error: { code: 'handler_error', message: 'One or more webhook handlers failed.' },
    }
  }

  return { status: 'ok', eventId: opts.eventId, duplicate: false }
}
