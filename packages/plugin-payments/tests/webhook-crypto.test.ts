/**
 * The webhook path against Stripe's REAL signature crypto, with no network and
 * no credential.
 *
 * Every other test of this path mocks `constructEvent`, so none of them ever
 * ran the HMAC — which means none of them could catch our wiring mangling the
 * raw body or reading the wrong header. `generateTestHeaderString` is Stripe's
 * own helper and produces a genuine `t=…,v1=…` over the payload; verification
 * is the untouched `constructEvent`. Neither needs a valid API key, so this
 * runs on every push rather than once a night behind a credential gate.
 *
 * It was written in the e2e package first. It does not belong there: it makes
 * no network call, and putting a credential gate on assertions that need no
 * credential trades feedback on every push for feedback once a night.
 */
import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { definePaymentWebhook, PaymentEventRegistry } from '../src/dispatch.js'
import { createMemoryStore } from '../src/idempotency-store.js'
import { payments } from '../src/plugin.js'
import { StripeProvider } from '../src/providers/stripe.js'

// Crypto only — no request is ever made, so the key just has to parse.
const stripe = new Stripe('sk_test_offline_crypto_only')
const SECRET = 'whsec_test_offline_secret'

function signed(payload: string): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET })
}

const EVENT = JSON.stringify({
  id: 'evt_offline_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_probe' } },
})

function makePlugin(registry = new PaymentEventRegistry()) {
  return payments({
    providers: { stripe: StripeProvider({ client: stripe, webhookSecret: SECRET }) },
    registry,
    idempotencyStore: createMemoryStore(),
  })
}

describe('the plugin against real Stripe signature crypto', () => {
  it('verifies a genuine signature and dispatches the normalised event', async () => {
    const seen: string[] = []
    const registry = new PaymentEventRegistry()
    registry.register(
      definePaymentWebhook('checkout.completed', (event) => {
        seen.push(`${event.provider}:${event.providerEventType}`)
        return Promise.resolve()
      }),
    )

    const result = await makePlugin(registry).handleWebhook('stripe', {
      rawBody: EVENT,
      headers: { 'stripe-signature': signed(EVENT) },
    })

    expect(result).toMatchObject({ status: 'ok', duplicate: false })
    expect(seen).toEqual(['stripe:checkout.session.completed'])
  })

  it('does not run the handler twice for a redelivery of the same event', async () => {
    // Stripe retries for days. "Processed twice" is how a customer gets charged
    // or fulfilled twice.
    let runs = 0
    const registry = new PaymentEventRegistry()
    registry.register(
      definePaymentWebhook('checkout.completed', () => {
        runs += 1
        return Promise.resolve()
      }),
    )
    const plugin = makePlugin(registry)
    const request = { rawBody: EVENT, headers: { 'stripe-signature': signed(EVENT) } }

    expect(await plugin.handleWebhook('stripe', request)).toMatchObject({ duplicate: false })
    expect(await plugin.handleWebhook('stripe', request)).toMatchObject({ duplicate: true })
    expect(runs).toBe(1)
  })

  it('rejects a body altered after signing', async () => {
    const result = await makePlugin().handleWebhook('stripe', {
      rawBody: EVENT.replace('evt_offline_1', 'evt_tampered'),
      headers: { 'stripe-signature': signed(EVENT) },
    })
    expect(result).toMatchObject({ status: 'signature_invalid', provider: 'stripe' })
  })

  it('rejects a signature produced under a different secret', async () => {
    const other = stripe.webhooks.generateTestHeaderString({
      payload: EVENT,
      secret: 'whsec_a_different_secret',
    })
    const result = await makePlugin().handleWebhook('stripe', {
      rawBody: EVENT,
      headers: { 'stripe-signature': other },
    })
    expect(result).toMatchObject({ status: 'signature_invalid' })
  })

  it('rejects a stale signature, because the timestamp is part of what is signed', async () => {
    // Replay protection. A signature valid forever is a signature an attacker
    // can capture once and reuse.
    const stale = stripe.webhooks.generateTestHeaderString({
      payload: EVENT,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    })
    const result = await makePlugin().handleWebhook('stripe', {
      rawBody: EVENT,
      headers: { 'stripe-signature': stale },
    })
    expect(result).toMatchObject({ status: 'signature_invalid' })
  })
})
