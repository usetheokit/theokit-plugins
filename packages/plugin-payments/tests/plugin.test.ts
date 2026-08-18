/**
 * The neutral plugin — what a consumer puts in `theo.config.ts`.
 *
 * The contract went multi-provider before this did, so for a while the plugin a
 * consumer wired knew exactly one gateway while the types it programmed against
 * knew several. These tests hold that closed.
 */
import type { TheoApp } from 'theokit/server'
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

/**
 * A stand-in for what the framework actually passes to `register()`.
 *
 * Typed as the REAL `TheoApp` from `theokit/server`, so the compiler — not a
 * comment — is what proves the plugin speaks the framework's contract. The
 * fabricated `TheoPluginApp` this replaces declared `registerRoute` and
 * `hasRoute`, neither of which exists, and type-checked anyway because
 * TypeScript is structural and the parameter was never used (#42).
 */
function recordingApp(): { app: TheoApp; decorations: Map<string, unknown>; hooks: string[] } {
  const decorations = new Map<string, unknown>()
  const hooks: string[] = []
  const app: TheoApp = {
    decorateRequest: (key, value) => decorations.set(key, value),
    addHook: (name) => hooks.push(name),
  }
  return { app, decorations, hooks }
}

describe('payments() as a TheoKit adapter', () => {
  it('decorates every request, so a handler reaches the gateways through ctx', () => {
    // The whole point of being an adapter. Without this, `register()` is a no-op
    // and nothing the plugin holds is reachable from a route handler — the
    // consumer has to import and wire the plugin a second time by hand.
    const { app, decorations } = recordingApp()
    const plugin = payments({ providers: { stripe: fakeProvider('stripe') } })

    plugin.register(app)

    expect(decorations.has('payments')).toBe(true)
  })

  it('exposes only what a handler needs — not the store, not the registry', () => {
    // ISP, and it buys a real safety property rather than tidiness: a handler
    // holding `store` can claim or release an event id outside the dispatcher
    // and defeat idempotency; one holding `registry` can rewire routing
    // mid-request.
    const { app, decorations } = recordingApp()
    payments({ providers: { stripe: fakeProvider('stripe') } }).register(app)

    const surface = decorations.get('payments') as Record<string, unknown>
    expect(Object.keys(surface).sort()).toEqual(['handleWebhook', 'provider', 'providers'])
  })

  it('the decorated surface actually works, not just looks right', async () => {
    const { app, decorations } = recordingApp()
    const registry = new PaymentEventRegistry()
    const seen: string[] = []
    registry.register(
      definePaymentWebhook('checkout.completed', (e) => {
        seen.push(e.provider)
        return Promise.resolve()
      }),
    )
    payments({
      providers: { stripe: fakeProvider('stripe') },
      registry,
      idempotencyStore: createMemoryStore(),
    }).register(app)

    const surface = decorations.get('payments') as {
      handleWebhook: (g: string, r: typeof REQUEST) => Promise<{ status: string }>
      provider: (k: string) => { name: string }
    }
    expect(surface.provider('stripe').name).toBe('stripe')
    expect(await surface.handleWebhook('stripe', REQUEST)).toMatchObject({ status: 'ok' })
    expect(seen).toEqual(['stripe'])
  })

  it('registers no hook, because it has no cross-cutting behaviour to add', () => {
    // Stated as an assertion rather than left implicit: a payments plugin that
    // silently added an onRequest hook would run on every request in the app,
    // including the ones that never touch money.
    const { app, hooks } = recordingApp()
    payments({ providers: { stripe: fakeProvider('stripe') } }).register(app)
    expect(hooks).toEqual([])
  })
})

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

  it('namespaces by the routing key, so two gateways sharing a name do not collide', async () => {
    // The failure this prevents: two Stripe accounts both namespace to
    // "stripe" under provider.name, and the second account's event reads as a
    // duplicate of the first — a real payment silently never fulfilled.
    const handle = vi.fn(() => Promise.resolve())
    const registry = new PaymentEventRegistry()
    registry.register(definePaymentWebhook('checkout.completed', handle))
    const plugin = payments({
      providers: { 'stripe-eu': fakeProvider('stripe'), 'stripe-us': fakeProvider('stripe') },
      registry,
    })

    const eu = await plugin.handleWebhook('stripe-eu', REQUEST)
    const us = await plugin.handleWebhook('stripe-us', REQUEST)

    expect(eu).toMatchObject({ status: 'ok', duplicate: false, eventId: 'stripe-eu:evt_1' })
    expect(us).toMatchObject({ status: 'ok', duplicate: false, eventId: 'stripe-us:evt_1' })
    expect(handle).toHaveBeenCalledTimes(2)
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

  // A test asserting `registerRoute` was never called used to live here. It
  // could only ever pass: the method it named does not exist on `TheoApp`, so
  // nothing could have called it (#42). The real contract is covered by
  // "payments() as a TheoKit adapter" above.
})
