/**
 * Payments — live tests against the real Stripe API, in test mode.
 *
 * `packages/plugin-payments/tests/providers/stripe-provider.test.ts` proves the
 * provider builds the request we intend, against a fake `Stripe` client. A fake
 * agrees with whoever wrote it. What it cannot prove is the thing that actually
 * breaks: that the shape we POST is still the shape Stripe accepts, and — for
 * the idempotency assertion below — that the key travels somewhere Stripe reads.
 *
 * Three contracts, and nothing else:
 *
 *   auth + payload   the key reaches Stripe, our params are accepted, a hosted
 *                    session comes back with a URL
 *   idempotency      the SAME key returns the SAME session, so a retry does not
 *                    charge twice
 *   errors           two real refusals arrive as PaymentProviderError, not as a
 *                    raw Stripe throw
 *
 * WHAT WAS DELIBERATELY NOT ASSERTED, having been measured first:
 *
 * A check that every key of the provider's EVENT_MAP is still a real Stripe
 * event type. `GET /v1/events?types[]=…` looked like the way to ask, and it is
 * not: measured 2026-08-18, `types[]=checkout.session.this_does_not_exist`
 * returns HTTP 200 with an empty list, exactly like a valid type with no
 * matching events. The assertion would have passed with a fabricated event
 * name — a green tick proving nothing, which is the failure this package exists
 * to avoid. Stripe publishes no endpoint that enumerates valid event types, so
 * that map stays covered by review, not by this suite.
 *
 * Nothing is cleaned up. Sessions expire on their own in 24h and the test-mode
 * dashboard is not somebody's production ledger. STRIPE_TEST_PRICE_ID points at
 * a product named "theokit-e2e — do not use"; a delete racing a slow request
 * would make failures harder to read than the litter is worth.
 *
 * The credential guard lives in `src/credentials.ts`: a STRIPE_SECRET_KEY that
 * does not begin with sk_test_ makes the whole suite skip with that as the
 * stated reason, rather than being handled carefully.
 */

import { PaymentProviderError } from '@theokit/plugin-payments'
import { StripeProvider } from '@theokit/plugin-payments/stripe'
import Stripe from 'stripe'
import { expect, it } from 'vitest'

import { required, runMarker } from '../../src/credentials.js'
import { describeLive } from '../../src/harness.js'
import { serviceById } from '../../src/services.js'

const PAYMENTS = serviceById('payments')

function provider(apiKey = required('STRIPE_SECRET_KEY')) {
  return StripeProvider({ client: new Stripe(apiKey) })
}

function checkout(marker: string, overrides: Record<string, unknown> = {}) {
  return {
    items: [{ ref: required('STRIPE_TEST_PRICE_ID'), quantity: 1 }],
    successUrl: `https://example.com/ok?run=${marker}`,
    cancelUrl: `https://example.com/cancel?run=${marker}`,
    metadata: { marker },
    ...overrides,
  }
}

describeLive(PAYMENTS, 'checkout', () => {
  it('creates a hosted session Stripe accepts, and returns somewhere to send the customer', async () => {
    const marker = runMarker()
    const result = await provider().createCheckout(checkout(marker))

    expect(result.provider).toBe('stripe')
    // Asserting the SHAPE rather than "truthy" is what would catch a response
    // change that still returns something. `cs_test_` also re-proves we are in
    // test mode at the moment of the call, not merely at credential-check time.
    expect(result.id).toMatch(/^cs_test_[A-Za-z0-9]+$/)
    expect(result.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
  }, 60_000)

  it('returns the SAME session for a repeated idempotency key, so a retry cannot charge twice', async () => {
    // The assertion this suite exists for. StripeProvider passes the key as the
    // SECOND argument of sessions.create — a request option, not a param — and
    // both spellings type-check. @theokit/plugin-email shipped the wrong one for
    // months (#37): the key rode along as decorative payload and Resend
    // deduplicated nothing, while the README said it worked. Only a round trip
    // can tell the two apart, and this is that round trip.
    const marker = runMarker()
    const key = `${marker}-idem`

    const first = await provider().createCheckout(checkout(marker, { idempotencyKey: key }))
    const second = await provider().createCheckout(checkout(marker, { idempotencyKey: key }))

    expect(second.id).toBe(first.id)
  }, 90_000)
})

describeLive(
  PAYMENTS,
  'error mapping',
  () => {
    it('raises PaymentProviderError when Stripe cannot find the price', async () => {
      // Measured against the real API: Stripe answers 400 with
      // type=invalid_request_error, code=resource_missing, "No such price: …".
      // The contract is that this reaches the consumer as our typed error with
      // the cause preserved, never as a bare Stripe exception.
      const attempt = provider().createCheckout(
        checkout(runMarker(), { items: [{ ref: 'price_does_not_exist_at_all', quantity: 1 }] }),
      )

      await expect(attempt).rejects.toBeInstanceOf(PaymentProviderError)
      await expect(attempt).rejects.toMatchObject({ provider: 'stripe', code: 'checkout_failed' })
    }, 60_000)

    it('raises PaymentProviderError, not a bare SDK error, on a key Stripe rejects', async () => {
      // If the SDK ever throws before the provider's try/catch, this notices.
      // A rejected key is a 401, a different failure mode from the 400 above.
      const attempt = provider('sk_test_notarealkeyatall').createCheckout(checkout(runMarker()))

      await expect(attempt).rejects.toBeInstanceOf(PaymentProviderError)
    }, 60_000)
  },
  // Both paths need the key AND the price id: the second assertion sends a
  // deliberately bad key but still builds a payload from the real price.
  { sends: true },
)
