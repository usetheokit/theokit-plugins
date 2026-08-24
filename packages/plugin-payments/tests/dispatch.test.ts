/**
 * The provider-neutral webhook path: verify, deduplicate, dispatch.
 *
 * The claim/release logic itself is already covered against Stripe in
 * webhook.test.ts — both now run through the same core. What is tested here is
 * what only the multi-provider path can get wrong: routing on the NORMALISED
 * event type, and keeping two providers' event ids from colliding in one store.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  definePaymentWebhook,
  PaymentEventRegistry,
  processPaymentWebhook,
} from '../src/dispatch.js'
import { createMemoryStore } from '../src/idempotency-store.js'
import {
  type PaymentEvent,
  type PaymentProvider,
  WebhookSignatureError,
} from '../src/provider-types.js'

function providerReturning(event: Partial<PaymentEvent>, name = 'fake'): PaymentProvider {
  return {
    name,
    createCheckout: () =>
      Promise.resolve({ id: 'c', uiMode: 'hosted' as const, url: 'https://pay/1', provider: name, raw: {} }),
    retrieveCheckout: () =>
      Promise.resolve({ id: 'c', status: 'pending' as const, provider: name, raw: {} }),
    refund: () => Promise.resolve({ id: 'r', provider: name, raw: {} }),
    verifyWebhook: () =>
      Promise.resolve({
        type: 'checkout.completed',
        id: 'evt_1',
        providerEventType: 'checkout.session.completed',
        provider: name,
        raw: {},
        ...event,
      }),
  }
}

const REQUEST = { rawBody: '{}', headers: {} }

// A fabricated DSN, never a real one. This suite exists to prove the credential
// is redacted before it reaches a log, so the fixture has to look like one.
const FAKE_DSN = 'postgres://user:hunter2@db' // trufflehog:ignore

describe('PaymentEventRegistry', () => {
  it('routes on the normalised type and ignores types nobody registered', async () => {
    const seen: string[] = []
    const registry = new PaymentEventRegistry()
    registry.register(
      definePaymentWebhook('checkout.completed', (e) => {
        seen.push(e.providerEventType)
        return Promise.resolve()
      }),
    )

    await registry.dispatch({
      type: 'checkout.completed',
      id: 'a',
      providerEventType: 'transparent.completed',
      provider: 'abacatepay',
      raw: {},
    })
    await registry.dispatch({
      type: 'payment.refunded',
      id: 'b',
      providerEventType: 'charge.refunded',
      provider: 'stripe',
      raw: {},
    })

    expect(seen).toEqual(['transparent.completed'])
    expect(registry.hasHandlersFor('payment.refunded')).toBe(false)
  })

  it('runs every handler even when one throws, and surfaces all failures together', async () => {
    const ran: string[] = []
    const registry = new PaymentEventRegistry()
    registry.register(
      definePaymentWebhook('checkout.completed', () => {
        ran.push('first')
        return Promise.reject(new Error('boom'))
      }),
    )
    registry.register(
      definePaymentWebhook('checkout.completed', () => {
        ran.push('second')
        return Promise.resolve()
      }),
    )

    const err = await registry
      .dispatch({
        type: 'checkout.completed',
        id: 'a',
        providerEventType: 'x',
        provider: 'p',
        raw: {},
      })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AggregateError)
    // LIFO, and the failure of the first did not cancel the rest.
    expect(ran).toEqual(['second', 'first'])
  })
})

describe('processPaymentWebhook', () => {
  it('processes a first delivery and reports the second as a duplicate', async () => {
    const handle = vi.fn(() => Promise.resolve())
    const registry = new PaymentEventRegistry()
    registry.register(definePaymentWebhook('checkout.completed', handle))
    const store = createMemoryStore()
    const provider = providerReturning({})

    const first = await processPaymentWebhook({ provider, request: REQUEST, registry, store })
    const second = await processPaymentWebhook({ provider, request: REQUEST, registry, store })

    expect(first).toEqual({ status: 'ok', eventId: 'fake:evt_1', duplicate: false })
    expect(second).toEqual({ status: 'ok', eventId: 'fake:evt_1', duplicate: true })
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('does not let two providers sharing one store collide on the same event id', async () => {
    const handle = vi.fn(() => Promise.resolve())
    const registry = new PaymentEventRegistry()
    registry.register(definePaymentWebhook('checkout.completed', handle))
    const store = createMemoryStore()

    // Both gateways happen to emit "evt_1". Without namespacing, the second
    // would be swallowed as a duplicate and that payment would never be fulfilled.
    const a = await processPaymentWebhook({
      provider: providerReturning({ provider: 'stripe' }, 'stripe'),
      request: REQUEST,
      registry,
      store,
    })
    const b = await processPaymentWebhook({
      provider: providerReturning({ provider: 'abacatepay' }, 'abacatepay'),
      request: REQUEST,
      registry,
      store,
    })

    expect(a).toMatchObject({ duplicate: false, eventId: 'stripe:evt_1' })
    expect(b).toMatchObject({ duplicate: false, eventId: 'abacatepay:evt_1' })
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('returns signature_invalid instead of throwing, so the HTTP layer needs no try/catch', async () => {
    const provider: PaymentProvider = {
      ...providerReturning({}),
      verifyWebhook: () => Promise.reject(new WebhookSignatureError('abacatepay', 'bad secret')),
    }

    const result = await processPaymentWebhook({
      provider,
      request: REQUEST,
      registry: new PaymentEventRegistry(),
      store: createMemoryStore(),
    })

    expect(result).toEqual({
      status: 'signature_invalid',
      provider: 'abacatepay',
      message: 'bad secret',
    })
  })

  it('propagates a non-signature verification failure rather than reporting it as a bad signature', async () => {
    const provider: PaymentProvider = {
      ...providerReturning({}),
      verifyWebhook: () => Promise.reject(new Error('body passed the check but is not JSON')),
    }

    await expect(
      processPaymentWebhook({
        provider,
        request: REQUEST,
        registry: new PaymentEventRegistry(),
        store: createMemoryStore(),
      }),
    ).rejects.toThrow(/not JSON/)
  })

  it('releases the claim when a handler fails, so the provider’s retry can re-run it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let attempts = 0
    const registry = new PaymentEventRegistry()
    registry.register(
      definePaymentWebhook('checkout.completed', () => {
        attempts += 1
        return attempts === 1 ? Promise.reject(new Error('db down')) : Promise.resolve()
      }),
    )
    const store = createMemoryStore()
    const provider = providerReturning({})

    const failed = await processPaymentWebhook({ provider, request: REQUEST, registry, store })
    const retried = await processPaymentWebhook({ provider, request: REQUEST, registry, store })

    expect(failed).toMatchObject({ status: 'handler_error', eventId: 'fake:evt_1' })
    expect(retried).toEqual({ status: 'ok', eventId: 'fake:evt_1', duplicate: false })
    expect(attempts).toBe(2)
    consoleError.mockRestore()
  })

  it('never returns the raw handler error to the caller', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const registry = new PaymentEventRegistry()
    registry.register(
      definePaymentWebhook('checkout.completed', () =>
        Promise.reject(new Error(`connection to ${FAKE_DSN} failed`)),
      ),
    )

    const result = await processPaymentWebhook({
      provider: providerReturning({}),
      request: REQUEST,
      registry,
      store: createMemoryStore(),
    })

    expect(result).toEqual({
      status: 'handler_error',
      eventId: 'fake:evt_1',
      error: { code: 'handler_error', message: 'One or more webhook handlers failed.' },
    })
    expect(JSON.stringify(result)).not.toContain('hunter2')
    // The full error IS logged server-side, with the credential redacted.
    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).toContain('***:***@')
    expect(logged).not.toContain('hunter2')
    consoleError.mockRestore()
  })
})
