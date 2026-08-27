import { Post, Req } from '@theokit/http'

import { processWebhook, type WebhookResult } from '../webhook.js'
import type { WebhookRegistry } from '../webhook.js'
import type { IdempotencyStore } from '../idempotency-store.js'
import type { Stripe } from '../stripe.js'

/**
 * The Stripe webhook endpoint as a class an application EXTENDS, rather than a function it wires to
 * a route and translates by hand.
 *
 * `processWebhook` already decides what happened — processed, replayed, bad signature, handler threw
 * — and its docblock spells out the status each outcome maps to. That mapping was documentation, so
 * every consumer re-typed it, and a consumer who mapped `handler_error` to 200 would silently tell
 * Stripe to stop retrying a delivery that never succeeded. The mapping lives here now, once.
 *
 * Two things this class gets right that are easy to get wrong by hand:
 *
 *   - **The body is read once, as text, and never parsed.** Stripe signs the exact bytes it sent.
 *     A controller that took `@Body(schema)` would hand `processWebhook` a re-serialised object
 *     whose HMAC no longer matches, and every delivery would fail signature verification — or, worse,
 *     prompt someone to disable it. `@Req()` is not a stylistic choice here.
 *   - **A missing `stripe-signature` header stays absent**, not an empty string, so verification
 *     rejects it as missing rather than as malformed.
 *
 * It binds no URL prefix and no access decoration, deliberately: both are the application's, and a
 * base that decided either would force a consumer to edit this package to vary it.
 *
 * **The webhook endpoint MUST be public and CSRF-exempt.** Stripe carries no session and no CSRF
 * token; its authentication IS the signature this class verifies. That is a decision the application
 * declares on its subclass — this package cannot make it, and would be wrong to.
 *
 * @example
 * ```ts
 * \@Controller('api/stripe/webhook')
 * \@SetMetadata('theokit:public', true)
 * export class StripeWebhookController extends StripeWebhookControllerBase {
 *   protected readonly stripe = stripeClient()
 *   protected readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
 *   protected readonly registry = registry
 *   protected readonly store = store
 * }
 * ```
 */
export abstract class StripeWebhookControllerBase {
  protected abstract readonly stripe: Stripe
  /** From the Stripe dashboard. Distinct per endpoint, and not the API key. */
  protected abstract readonly webhookSecret: string
  protected abstract readonly registry: WebhookRegistry
  /** What makes a replayed delivery a no-op. Stripe retries, so this is not optional in practice. */
  protected abstract readonly store: IdempotencyStore

  @Post()
  async handle(@Req() request: Request): Promise<Response> {
    const rawBody = await request.text()
    // `Headers.get` answers null for absent; `?? undefined` keeps "absent" distinguishable from
    // "present and empty", which verification treats differently.
    const signature = request.headers.get('stripe-signature') ?? undefined

    return this.toResponse(await this.process(rawBody, signature))
  }

  /**
   * Seam for a subclass that needs to reach verification differently — a second endpoint secret
   * during rotation, a per-tenant client, a delivery log. Overriding it keeps the raw-body handling
   * and the status mapping; replacing `handle` outright does not.
   */
  protected process(rawBody: string, signature: string | undefined): Promise<WebhookResult> {
    return processWebhook({
      stripe: this.stripe,
      rawBody,
      signatureHeader: signature,
      webhookSecret: this.webhookSecret,
      registry: this.registry,
      store: this.store,
    })
  }

  /**
   * The mapping `processWebhook` documents, made executable.
   *
   * A replayed event answers 200 on purpose: it was already handled, and any other status asks
   * Stripe to keep retrying something that is finished. A handler error answers 500 on purpose:
   * the delivery genuinely did not succeed, and Stripe's retry is the recovery.
   *
   * The error body carries the event id and nothing else. `SanitizedWebhookError` is already
   * redacted, but the boundary this class owns is that the consumer's error text never crosses it
   * at all — a Stripe key in a thrown message must not reach a response, redacted or not.
   */
  protected toResponse(result: WebhookResult): Response {
    if (result.status === 'ok') {
      return Response.json({ received: true, eventId: result.eventId, duplicate: result.duplicate })
    }
    if (result.status === 'signature_invalid') {
      return Response.json({ error: 'SIGNATURE_INVALID', message: result.message }, { status: 400 })
    }
    return Response.json({ error: 'HANDLER_ERROR', eventId: result.eventId }, { status: 500 })
  }
}
