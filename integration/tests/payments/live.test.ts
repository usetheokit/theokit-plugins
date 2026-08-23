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

import {
  PaymentProviderError,
  supportsPartialRefund,
  supportsSubscriptions,
} from '@theokit/plugin-payments'
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

describeLive(PAYMENTS, 'subscription mode', () => {
  it('starts a recurring checkout, which the contract could not express before #39', async () => {
    // Until #39 the provider hardcoded mode:"payment", so the neutral surface
    // could not begin a subscription on EITHER provider — and every active price
    // on this account is recurring, making the real catalogue unreachable.
    const marker = runMarker()
    const result = await provider().createCheckout({
      ...checkout(marker),
      items: [{ ref: required('STRIPE_TEST_RECURRING_PRICE_ID'), quantity: 1 }],
      mode: 'subscription',
    })

    expect(result.id).toMatch(/^cs_test_[A-Za-z0-9]+$/)
    expect(result.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    // `raw` is the untouched session, so the mode Stripe actually recorded is
    // observable — asserting our own input back would prove nothing.
    expect((result.raw as { mode?: string }).mode).toBe('subscription')
  }, 60_000)

  it('surfaces Stripe refusing a one-time price in subscription mode', async () => {
    // The symmetric refusal, measured 2026-08-18: "You must provide at least one
    // recurring price in `subscription` mode when using prices." Asserting both
    // directions is what shows the mode reaches Stripe rather than being ignored
    // — a provider that dropped the field would pass the happy-path test alone.
    const attempt = provider().createCheckout({
      ...checkout(runMarker()),
      mode: 'subscription',
    })

    await expect(attempt).rejects.toMatchObject({ provider: 'stripe', code: 'checkout_failed' })
    await expect(attempt).rejects.toThrow(/recurring price/i)
  }, 60_000)
})

/**
 * A real charge, with no browser in the loop.
 *
 * Refunds cannot be exercised against a Checkout Session here — paying one needs
 * a person at a page. Stripe's test mode has a way around that: confirm a
 * PaymentIntent with the `pm_card_visa` test method and a real, refundable
 * charge exists. So the refund path is measured end to end, against money that
 * actually moved, rather than asserted against a fake.
 */
async function paidCharge(amountInCents: number): Promise<string> {
  const stripe = new Stripe(required('STRIPE_SECRET_KEY'))
  const intent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: 'usd',
    payment_method: 'pm_card_visa',
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  })
  expect(intent.status, 'the test charge did not succeed, so the refund proves nothing').toBe(
    'succeeded',
  )
  return intent.id
}

describeLive(PAYMENTS, 'subscription lifecycle', () => {
  it('cancels a subscription that was really active', async () => {
    // Starting one and being unable to stop it is not a subscription feature.
    // Like the refund path, this needs a real active subscription and no
    // browser: a customer with the test card attached can be subscribed
    // directly, which produces a `sub_…` in `active` status to cancel.
    const stripe = new Stripe(required('STRIPE_SECRET_KEY'))
    const customer = await stripe.customers.create({
      payment_method: 'pm_card_visa',
      invoice_settings: { default_payment_method: 'pm_card_visa' },
      metadata: { owner: 'theokit-plugins-e2e', marker: runMarker() },
    })
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: required('STRIPE_TEST_RECURRING_PRICE_ID') }],
    })
    expect(sub.status, 'the fixture subscription is not active, so cancelling proves nothing').toBe(
      'active',
    )

    const p = provider()
    expect(supportsSubscriptions(p)).toBe(true)
    if (!supportsSubscriptions(p)) return
    const result = await p.cancelSubscription(sub.id)

    expect(result).toMatchObject({ id: sub.id, status: 'cancelled', provider: 'stripe' })
    // Asserted against Stripe, not against our own return value — re-reading is
    // what distinguishes "we said cancelled" from "it is cancelled".
    expect((await stripe.subscriptions.retrieve(sub.id)).status).toBe('canceled')
  }, 90_000)

  it('says a one-off checkout started no subscription, instead of a confusing 4xx', async () => {
    const session = await provider().createCheckout(checkout(runMarker()))
    const p = provider()
    if (!supportsSubscriptions(p)) throw new Error('unreachable')

    await expect(p.cancelSubscription(session.id)).rejects.toMatchObject({
      code: 'no_subscription',
    })
  }, 60_000)
})

describeLive(PAYMENTS, 'refunds', () => {
  it('refunds a charge in full, against money that really moved', async () => {
    const reference = await paidCharge(500)
    const result = await provider().refund({ reference, reason: runMarker() })

    expect(result.provider).toBe('stripe')
    expect(result.id).toMatch(/^re_/)
    expect(result.amountInCents).toBe(500)
  }, 90_000)

  it('refunds part of a charge, through the capability guard', async () => {
    const p = provider()
    // The guard is not decoration: this is the line that would not compile
    // against AbacatePay, which refunds integrally and says so.
    expect(supportsPartialRefund(p)).toBe(true)
    if (!supportsPartialRefund(p)) return

    const reference = await paidCharge(1000)
    const result = await p.refundPartial({ reference, amountInCents: 400 })

    expect(result.amountInCents).toBe(400)
  }, 90_000)

  it('refuses to refund a session nobody paid, before Stripe can confuse the reader', async () => {
    // Measured 2026-08-18: passing a cs_ id straight to /v1/refunds returns
    // "No such payment_intent: cs_…", which sends whoever reads the log looking
    // for a payment intent that never existed. The provider resolves the session
    // first and says what is actually wrong.
    const session = await provider().createCheckout(checkout(runMarker()))
    const attempt = provider().refund({ reference: session.id })

    await expect(attempt).rejects.toMatchObject({ code: 'nothing_to_refund' })
  }, 60_000)
})

describeLive(PAYMENTS, 'status reconciliation', () => {
  it('answers where an unpaid session stands, so a dropped webhook is recoverable', async () => {
    // Webhook delivery is at-least-once, which is not at-least-one: a dropped
    // delivery, a deploy inside the retry window, or an endpoint that 500s past
    // the give-up point all end with a paid customer and an unfulfilled order.
    // This is the ASK that makes reconciliation possible without the SDK.
    const created = await provider().createCheckout(checkout(runMarker()))
    const status = await provider().retrieveCheckout(created.id)

    expect(status).toMatchObject({
      id: created.id,
      status: 'pending',
      provider: 'stripe',
      amountRefundedInCents: 0,
    })

    // Read the amount off the fixture rather than hardcoding it. `amountInCents: 500` and
    // `currency: 'USD'` were asserted against a price whose provisioning instructions say only
    // "create a product with a one-time price" — so an operator following them to the letter got
    // a failure pointing at the provider, for a fixture that was never specified (#94).
    //
    // This is also the stronger claim. Reconciliation is worth having because it reports what the
    // session actually holds; comparing that to the price it was built from tests the provider,
    // while comparing it to a literal tests the dashboard.
    const price = await new Stripe(required('STRIPE_SECRET_KEY')).prices.retrieve(
      required('STRIPE_TEST_PRICE_ID'),
    )
    // `unit_amount` is null for tiered and metered prices. Asserting it first turns "the fixture
    // is the wrong KIND of price" into a sentence, instead of a comparison against null that
    // reads like the provider dropped the amount.
    expect(
      typeof price.unit_amount,
      `STRIPE_TEST_PRICE_ID (${price.id}) has no unit_amount — it must be a simple one-time price`,
    ).toBe('number')
    expect(
      status.amountInCents,
      'the reported amount is not the price the session was built from',
    ).toBe(price.unit_amount)
    expect(status.currency?.toLowerCase(), 'the reported currency is not the price currency').toBe(
      price.currency,
    )
  }, 60_000)

  it('raises PaymentProviderError for a session that does not exist', async () => {
    await expect(provider().retrieveCheckout('cs_test_doesnotexist')).rejects.toMatchObject({
      provider: 'stripe',
      code: 'retrieve_failed',
    })
  }, 60_000)
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
