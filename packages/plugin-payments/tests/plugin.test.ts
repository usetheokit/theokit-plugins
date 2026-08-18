/**
 * The neutral plugin — what a consumer puts in `theo.config.ts`.
 *
 * The contract went multi-provider before this did, so for a while the plugin a
 * consumer wired knew exactly one gateway while the types it programmed against
 * knew several. These tests hold that closed.
 */
import { describe, expect, it, vi } from 'vitest'

import { createMemoryStore } from '../src/idempotency-store.js'
import { definePaymentWebhook, PaymentEventRegistry } from '../src/dispatch.js'
import { payments } from '../src/plugin.js'
import type { PaymentEvent, PaymentProvider } from '../src/provider-types.js'
import { WebhookSignatureError } from '../src/provider-types.js'

function fakeProvider(name: string, event: Partial<PaymentEvent> = {}): PaymentProvider {
  return {
    name,
    createCheckout: () =>
      Promise.resolve({ id: 'c', url: 'https://pay/1', provider: name, raw: {} }),
    verifyWebhook: () =>
      Promise.resolve({
        type: 'checkout.completed',
        id: 'evt_1',
        providerEventType: 'x',
        provider: name,
        raw: {},
        ...event,
      }),
    retrieveCheckout: () =>
      Promise.resolve({ id: 'c', status: 'pending' as const, provider: name, raw: {} }),
    refund: () => Promise.resolve({ id: 'r', provider: name, raw: {} }),
  }
}

const REQUEST = { rawBody: '{}', headers: {} }

describe('payments()', () => {
  it('refuses to boot with no provider, rather than failing at the first checkout', () => {
    expect(() => payments({ providers: {} })).toThrow(/at least one provider is required/)
  })

  it('keys providers by the name the app routes them under, not by provider.name', () => {
    // Two Stripe accounts is a real shape — marketplace, separate legal
    // entities — and deriving the key from provider.name would collapse them.
    const plugin = payments({
      providers: { 'stripe-eu': fakeProvider('stripe'), 'stripe-us': fakeProvider('stripe') },
    })
    expect(Object.keys(plugin.providers).sort()).toEqual(['stripe-eu', 'stripe-us'])
    expect(plugin.provider('stripe-eu').name).toBe('stripe')
  })

  it('names what IS registered when asked for something that is not', () => {
    const plugin = payments({ providers: { stripe: fakeProvider('stripe') } })
    expect(() => plugin.provider('strpe')).toThrow(/Registered: stripe/)
  })

  it('routes a webhook to the gateway the URL named, and dispatches it', async () => {
    const handled: string[] = []
    const registry = new PaymentEventRegistry()
    registry.register(
      definePaymentWebhook('checkout.completed', (e) => {
        handled.push(e.provider)
        return Promise.resolve()
      }),
    )
    const plugin = payments({
      providers: {
        stripe: fakeProvider('stripe'),
        abacatepay: fakeProvider('abacatepay'),
      },
      registry,
      idempotencyStore: createMemoryStore(),
    })

    const result = await plugin.handleWebhook('abacatepay', REQUEST)

    expect(result).toMatchObject({ status: 'ok', duplicate: false })
    expect(handled).toEqual(['abacatepay'])
  })

  it('shares one store across gateways without letting their event ids collide', async () => {
    // Both fakes emit evt_1. One store, and the second must still be new —
    // otherwise a real payment is swallowed as a duplicate.
    const handle = vi.fn(() => Promise.resolve())
    const registry = new PaymentEventRegistry()
    registry.register(definePaymentWebhook('checkout.completed', handle))
    const plugin = payments({
      providers: { stripe: fakeProvider('stripe'), abacatepay: fakeProvider('abacatepay') },
      registry,
    })

    const a = await plugin.handleWebhook('stripe', REQUEST)
    const b = await plugin.handleWebhook('abacatepay', REQUEST)
    const again = await plugin.handleWebhook('stripe', REQUEST)

    expect(a).toMatchObject({ duplicate: false })
    expect(b).toMatchObject({ duplicate: false })
    expect(again).toMatchObject({ duplicate: true })
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('returns signature_invalid rather than throwing, so a route needs no try/catch', async () => {
    const plugin = payments({
      providers: {
        abacatepay: {
          ...fakeProvider('abacatepay'),
          verifyWebhook: () =>
            Promise.reject(new WebhookSignatureError('abacatepay', 'bad secret')),
        },
      },
    })
    await expect(plugin.handleWebhook('abacatepay', REQUEST)).resolves.toMatchObject({
      status: 'signature_invalid',
      provider: 'abacatepay',
    })
  })

  it('copies the providers map, so mutating the caller`s object cannot rewire the plugin', () => {
    const providers: Record<string, PaymentProvider> = { stripe: fakeProvider('stripe') }
    const plugin = payments({ providers })
    providers.stripe = fakeProvider('impostor')
    expect(plugin.provider('stripe').name).toBe('stripe')
  })

  it('registers into an app without claiming a route', () => {
    // A plugin that grabs /api/payments/webhook collides with the app that
    // already had one. The path stays the consumer's choice.
    const registerRoute = vi.fn()
    payments({ providers: { stripe: fakeProvider('stripe') } }).register({ registerRoute })
    expect(registerRoute).not.toHaveBeenCalled()
  })
})
