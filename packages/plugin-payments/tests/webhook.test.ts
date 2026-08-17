/**
 * RED tests for P#6 T2.1 + T2.2 — webhook dispatcher + signature verification
 *
 * Per plan p6-plugin-payments v1.0 § Phase 2 / T2.1 + T2.2.
 */
import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

import {
  defineStripeWebhook,
  processWebhook,
  StripeSignatureError,
  verifyAndParseWebhook,
  WebhookRegistry,
} from '../src/webhook.js'
import { createMemoryStore } from '../src/idempotency-store.js'

// Helper: build a fake Stripe.Event for dispatcher tests (does NOT exercise
// signature verification path).
function fakeEvent<T extends Stripe.Event['type']>(
  type: T,
  id = `evt_${Math.random().toString(36).slice(2)}`,
): Stripe.Event {
  return {
    id,
    type,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    data: { object: {} as never },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as Stripe.Event
}

describe('defineStripeWebhook + WebhookRegistry (P#6 T2.1)', () => {
  it('registers and dispatches a handler for a specific event type', async () => {
    const registry = new WebhookRegistry()
    let invokedWith: Stripe.Event | null = null

    const handler = defineStripeWebhook('checkout.session.completed', (event) => {
      invokedWith = event
      return Promise.resolve()
    })
    registry.register(handler)

    const event = fakeEvent('checkout.session.completed')
    await registry.dispatch(event)

    expect(invokedWith).toBe(event)
  })

  it('does NOT invoke handlers for unmatched event types (no-op, no error)', async () => {
    const registry = new WebhookRegistry()
    let invoked = false

    registry.register(
      defineStripeWebhook('checkout.session.completed', () => {
        invoked = true
        return Promise.resolve()
      }),
    )

    // Dispatch a different event type
    await registry.dispatch(fakeEvent('payment_intent.succeeded'))
    expect(invoked).toBe(false)
  })

  it('multiple handlers for same event type run in LIFO order', async () => {
    const registry = new WebhookRegistry()
    const order: string[] = []

    registry.register(
      defineStripeWebhook('checkout.session.completed', () => {
        order.push('first')
        return Promise.resolve()
      }),
    )
    registry.register(
      defineStripeWebhook('checkout.session.completed', () => {
        order.push('second')
        return Promise.resolve()
      }),
    )

    await registry.dispatch(fakeEvent('checkout.session.completed'))

    // LIFO: last registered runs first
    expect(order).toEqual(['second', 'first'])
  })

  it('handler throwing propagates the error (as an AggregateError) to the caller', async () => {
    const registry = new WebhookRegistry()
    registry.register(
      defineStripeWebhook('checkout.session.completed', () =>
        Promise.reject(new Error('user handler failed')),
      ),
    )

    // T2.3 (#208): dispatch always throws a uniform AggregateError on failure
    // (even for a single handler) so the HTTP layer handles ONE error shape.
    const thrown = await registry
      .dispatch(fakeEvent('checkout.session.completed'))
      .catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toHaveLength(1)
    expect(((thrown as AggregateError).errors[0] as Error).message).toBe('user handler failed')
  })

  it('hasHandlersFor reports registration state', () => {
    const registry = new WebhookRegistry()
    expect(registry.hasHandlersFor('checkout.session.completed')).toBe(false)

    registry.register(defineStripeWebhook('checkout.session.completed', () => Promise.resolve()))
    expect(registry.hasHandlersFor('checkout.session.completed')).toBe(true)
  })

  it('T3.5: dispatch runs all handlers even if first throws', async () => {
    const registry = new WebhookRegistry()
    const handler1 = vi.fn(() => Promise.resolve())
    const handler2 = vi.fn(() => Promise.reject(new Error('handler-2-fail')))
    const handler3 = vi.fn(() => Promise.resolve())

    registry.register(defineStripeWebhook('checkout.session.completed', handler1))
    registry.register(defineStripeWebhook('checkout.session.completed', handler2))
    registry.register(defineStripeWebhook('checkout.session.completed', handler3))

    await expect(registry.dispatch(fakeEvent('checkout.session.completed'))).rejects.toThrow()

    // All 3 handlers called despite handler2 throwing
    expect(handler1).toHaveBeenCalledOnce()
    expect(handler2).toHaveBeenCalledOnce()
    expect(handler3).toHaveBeenCalledOnce()
  })

  // T2.3 (#208) — dispatch now AGGREGATES all handler errors into an
  // AggregateError instead of throwing only the first and console.error-ing the
  // rest (which silently lost failures). Run-all is preserved; every error surfaces.
  it('aggregates all handler errors into an AggregateError (#208)', async () => {
    const registry = new WebhookRegistry()
    registry.register(
      defineStripeWebhook('checkout.session.completed', () =>
        Promise.reject(new Error('handler-1-fail')),
      ),
    )
    registry.register(
      defineStripeWebhook('checkout.session.completed', () =>
        Promise.reject(new Error('handler-2-fail')),
      ),
    )

    const thrown = await registry
      .dispatch(fakeEvent('checkout.session.completed'))
      .catch((e: unknown) => e)

    expect(thrown).toBeInstanceOf(AggregateError)
    const agg = thrown as AggregateError
    const messages = agg.errors.map((e) => (e as Error).message).sort()
    expect(messages).toEqual(['handler-1-fail', 'handler-2-fail'])
  })
})

describe('verifyAndParseWebhook (P#6 T2.2)', () => {
  it('returns the parsed event when signature is valid', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_test_xxx'
    const payload = JSON.stringify({
      id: 'evt_test_signed',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })

    const event = verifyAndParseWebhook(stripe, payload, header, secret)
    expect(event.id).toBe('evt_test_signed')
    expect(event.type).toBe('checkout.session.completed')
  })

  it('throws StripeSignatureError when signature header is missing', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })

    expect(() => verifyAndParseWebhook(stripe, '{}', undefined, 'whsec_xxx')).toThrow(
      StripeSignatureError,
    )
  })

  it('throws StripeSignatureError when body is tampered', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_test_xxx'
    const payload = JSON.stringify({ id: 'evt_signed', type: 'test.event' })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })

    // Tamper the body
    const tampered = payload.replace('evt_signed', 'evt_TAMPERED')
    expect(() => verifyAndParseWebhook(stripe, tampered, header, secret)).toThrow(
      StripeSignatureError,
    )
  })
})

describe('processWebhook (P#6 T2.1 + T2.2 + T2.3 integration)', () => {
  it('returns ok+duplicate=false on first delivery of a new event', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_xxx'
    const payload = JSON.stringify({
      id: 'evt_first_delivery',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })

    const registry = new WebhookRegistry()
    let invocations = 0
    registry.register(
      defineStripeWebhook('checkout.session.completed', () => {
        invocations += 1
        return Promise.resolve()
      }),
    )

    const result = await processWebhook({
      stripe,
      rawBody: payload,
      signatureHeader: header,
      webhookSecret: secret,
      registry,
      store: createMemoryStore(),
    })

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.duplicate).toBe(false)
      expect(result.eventId).toBe('evt_first_delivery')
    }
    expect(invocations).toBe(1)
  })

  it('returns ok+duplicate=true on second delivery (idempotency)', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_xxx'
    const payload = JSON.stringify({
      id: 'evt_dup_delivery',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })

    const registry = new WebhookRegistry()
    let invocations = 0
    registry.register(
      defineStripeWebhook('checkout.session.completed', () => {
        invocations += 1
        return Promise.resolve()
      }),
    )
    const store = createMemoryStore()

    // First delivery
    await processWebhook({
      stripe,
      rawBody: payload,
      signatureHeader: header,
      webhookSecret: secret,
      registry,
      store,
    })

    // Second delivery (Stripe retry)
    const result = await processWebhook({
      stripe,
      rawBody: payload,
      signatureHeader: header,
      webhookSecret: secret,
      registry,
      store,
    })

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.duplicate).toBe(true)
    }
    // Handler invoked exactly once total despite two deliveries
    expect(invocations).toBe(1)
  })

  it('returns signature_invalid when body is tampered', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_xxx'
    const payload = JSON.stringify({
      id: 'evt_orig',
      type: 'checkout.session.completed',
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
    const tampered = payload.replace('evt_orig', 'evt_HACKED')

    const result = await processWebhook({
      stripe,
      rawBody: tampered,
      signatureHeader: header,
      webhookSecret: secret,
      registry: new WebhookRegistry(),
      store: createMemoryStore(),
    })

    expect(result.status).toBe('signature_invalid')
  })

  it("returns handler_error when consumer's handler throws", async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_xxx'
    const payload = JSON.stringify({
      id: 'evt_handler_error',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })

    const registry = new WebhookRegistry()
    registry.register(
      defineStripeWebhook(
        'checkout.session.completed',
        () =>
          // Raw handler errors may carry PII/secrets — must NOT reach the boundary.
          Promise.reject(new Error('DB write failed: postgres://user:s3cret@db/prod')), // trufflehog:ignore — fixture, not a live credential
      ),
    )

    const result = await processWebhook({
      stripe,
      rawBody: payload,
      signatureHeader: header,
      webhookSecret: secret,
      registry,
      store: createMemoryStore(),
    })

    expect(result.status).toBe('handler_error')
    if (result.status === 'handler_error') {
      expect(result.eventId).toBe('evt_handler_error')
      // #201/D5: boundary error is a sanitized {code,message}, NOT the raw error.
      expect(result.error.code).toBe('handler_error')
      expect(result.error.message).not.toContain('DB write failed')
      expect(result.error.message).not.toContain('s3cret')
    }
  })

  it('logs the full handler error server-side with secrets redacted (#201)', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_xxx'
    const payload = JSON.stringify({
      id: 'evt_redact_log',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
    const registry = new WebhookRegistry()
    registry.register(
      defineStripeWebhook('checkout.session.completed', () =>
        Promise.reject(new Error('leak whsec_supersecret123 and sk_live_abc999')),
      ),
    )
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* intentionally empty — silence console output under test */
    })
    await processWebhook({
      stripe,
      rawBody: payload,
      signatureHeader: header,
      webhookSecret: secret,
      registry,
      store: createMemoryStore(),
    })
    expect(spy).toHaveBeenCalled() // the full error IS logged server-side
    const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(logged).not.toContain('whsec_supersecret123')
    expect(logged).not.toContain('sk_live_abc999')
    spy.mockRestore()
  })

  // F-dom-pay-5 — a release() failure whose error carries a credential must be
  // redacted before hitting the server log, mirroring the handler-error path.
  it('test_release_error_is_redacted_in_log', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_xxx'
    const payload = JSON.stringify({
      id: 'evt_release_redact',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
    const registry = new WebhookRegistry()
    registry.register(
      defineStripeWebhook('checkout.session.completed', () =>
        // enter the catch → release path
        Promise.reject(new Error('handler boom')),
      ),
    )
    // Minimal store: claim is new (true) so the release branch runs; release
    // throws an error carrying credentials.
    const leakyStore = {
      markProcessed: () => Promise.resolve(true),
      release: () =>
        Promise.reject(new Error('release failed whsec_supersecret123 and sk_live_abc999')),
    } as unknown as Parameters<typeof processWebhook>[0]['store']
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* intentionally empty — silence console output under test */
    })
    await processWebhook({
      stripe,
      rawBody: payload,
      signatureHeader: header,
      webhookSecret: secret,
      registry,
      store: leakyStore,
    })
    const releaseLogCall = spy.mock.calls.find((c) =>
      String(c[0]).includes('failed to release idempotency claim'),
    )
    expect(releaseLogCall).toBeDefined() // the release-failure log fired
    const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(logged).not.toContain('whsec_supersecret123')
    expect(logged).not.toContain('sk_live_abc999')
    expect(logged).toContain('***REDACTED***') // redaction actually ran
    spy.mockRestore()
  })

  // T2.2 (#167) — a throwing handler must leave the event UNMARKED so Stripe's
  // retry re-runs it. Before the fix, the event was marked before dispatch, so
  // the retry deduped (duplicate) and the handler never ran again (at-most-once).
  it('re-invokes a throwing handler on the next delivery (event left unmarked, #167)', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_xxx'
    const payload = JSON.stringify({
      id: 'evt_retry_after_fail',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })

    const registry = new WebhookRegistry()
    let invocations = 0
    registry.register(
      defineStripeWebhook('checkout.session.completed', () => {
        invocations += 1
        return Promise.reject(new Error('transient DB outage'))
      }),
    )
    const store = createMemoryStore() // SHARED across both deliveries

    const call = () =>
      processWebhook({
        stripe,
        rawBody: payload,
        signatureHeader: header,
        webhookSecret: secret,
        registry,
        store,
      })

    const first = await call()
    const second = await call() // Stripe retry

    expect(first.status).toBe('handler_error')
    expect(second.status).toBe('handler_error') // NOT deduped as a no-op
    expect(invocations).toBe(2) // handler ran on BOTH deliveries (fails today: 1)
  })

  // EC-3 — multi-handler partial failure: the whole event is released on any
  // handler throw, so a retry re-invokes the succeeded handler too. Handlers
  // MUST therefore be idempotent (documented in defineStripeWebhook).
  it('re-invokes an already-succeeded handler when a sibling handler throws (EC-3 at-least-once)', async () => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe('sk_test_xxx', { apiVersion: '2023-10-16' })
    const secret = 'whsec_xxx'
    const payload = JSON.stringify({
      id: 'evt_partial_failure',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })

    const registry = new WebhookRegistry()
    let aInvocations = 0
    registry.register(
      defineStripeWebhook('checkout.session.completed', () => {
        aInvocations += 1 // handler A — succeeds
        return Promise.resolve()
      }),
    )
    registry.register(
      defineStripeWebhook('checkout.session.completed', () =>
        // handler B — throws
        Promise.reject(new Error('handler B failed')),
      ),
    )
    const store = createMemoryStore()
    const call = () =>
      processWebhook({
        stripe,
        rawBody: payload,
        signatureHeader: header,
        webhookSecret: secret,
        registry,
        store,
      })

    await call()
    await call() // retry

    // A re-runs on the retry (event was released) → A must be idempotent.
    expect(aInvocations).toBe(2)
  })
})
