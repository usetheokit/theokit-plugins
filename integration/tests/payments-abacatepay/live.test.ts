/**
 * Payments — live tests against the real AbacatePay API, in sandbox (devMode).
 *
 * This suite is the one #41 asked for. Until it existed, every AbacatePay path
 * was implemented from published documentation and covered only against a fake
 * `fetch`, and the README said so in a warning block. Writing it immediately
 * refuted two things the documentation had told us:
 *
 *   1. `/checkouts/refund` does NOT accept every id shape. The docs' prefix
 *      table says it takes bill_, char_, pix_char_ and card_; the API answers
 *      "Use a rota /v2/transparents/refund para reembolsar cobranças
 *      transparentes." The provider's prefix routing had been DELETED on the
 *      strength of that table and is now restored, with the measurement as the
 *      reason.
 *
 *   2. `createCheckout` could not create anything on this store. Without
 *      `methods`, the API inherits its default and answers "CARD is not
 *      available for this store" — and AbacatePay has since commented CARD out
 *      of its own docs, making PIX-only the norm.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT COVER, each measured rather than
 * assumed:
 *
 *   subscriptions      AbacatePay commented the entire section out of its docs.
 *                      `/subscriptions/create` still answers, with "PIX
 *                      Automático is not available for this store" — a
 *                      capability error, so the endpoint exists and the product
 *                      does not. Nothing here can prove a mapping for it.
 *
 *   verifyWebhook      delivery needs a public HTTPS endpoint. Signing a payload
 *                      here and verifying it here would only prove our HMAC
 *                      agrees with our HMAC — the circularity this package
 *                      exists to avoid. The query-secret half is pure string
 *                      comparison and already covered in the package's units.
 *
 * Nothing is cleaned up: the products and charges stay in the sandbox dashboard,
 * where the product is named "theokit-e2e — do not use".
 */

import { PaymentProviderError, supportsPix } from '@theokit/plugin-payments'
import { AbacatePayProvider } from '@theokit/plugin-payments/abacatepay'
import { expect, it } from 'vitest'

import { required, runMarker } from '../../src/credentials.js'
import { describeLive } from '../../src/harness.js'
import { serviceById } from '../../src/services.js'

const ABACATEPAY = serviceById('payments-abacatepay')

function provider(apiKey = required('ABACATEPAY_API_KEY')) {
  // methods: ['PIX'] is not a test convenience — see point 2 in the docstring.
  return AbacatePayProvider({ apiKey, methods: ['PIX'] })
}

/** Move a PIX charge to PAID the only way devMode allows. */
async function simulatePayment(chargeId: string): Promise<void> {
  const res = await fetch(
    `https://api.abacatepay.com/v2/transparents/simulate-payment?id=${encodeURIComponent(chargeId)}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${required('ABACATEPAY_API_KEY')}`,
        'content-type': 'application/json',
      },
      body: '{}',
    },
  )
  const body = (await res.json()) as { data?: { status?: string }; error?: string | null }
  // The id travels in the QUERY STRING. In the body it answers "Expected
  // property 'id' to be string but found: undefined" — measured, because the
  // docs do not say which.
  expect(body.error ?? null, 'simulate-payment failed, so nothing downstream proves anything').toBe(
    null,
  )
  expect(body.data?.status).toBe('PAID')
}

describeLive(ABACATEPAY, 'checkout', () => {
  it('creates a hosted checkout AbacatePay accepts, and returns somewhere to send the customer', async () => {
    const result = await provider().createCheckout({
      items: [{ ref: required('ABACATEPAY_TEST_PRODUCT_ID'), quantity: 1 }],
      currency: 'BRL',
      successUrl: `https://example.com/ok?run=${runMarker()}`,
      cancelUrl: 'https://example.com/back',
    })

    expect(result.provider).toBe('abacatepay')
    // Shape, not truthiness: `bill_` is the hosted-checkout prefix, and the
    // provider's own retrieve/refund routing keys off exactly that.
    expect(result.id).toMatch(/^bill_[A-Za-z0-9]+$/)
    expect(result.url).toMatch(/^https:\/\/app\.abacatepay\.com\/pay\/bill_/)
  }, 60_000)

  it('refuses a non-BRL charge without spending a round trip', async () => {
    // Client-side, and worth asserting live anyway: the guarantee is that the
    // amount is never reinterpreted, and a provider that dropped the check would
    // let the API decide what USD means in a BRL-only account.
    const attempt = provider().createCheckout({
      items: [{ ref: required('ABACATEPAY_TEST_PRODUCT_ID'), quantity: 1 }],
      currency: 'USD',
    })

    await expect(attempt).rejects.toMatchObject({
      provider: 'abacatepay',
      code: 'unsupported_currency',
    })
  }, 30_000)

  it('surfaces a product that does not exist as PaymentProviderError', async () => {
    const attempt = provider().createCheckout({
      items: [{ ref: 'prod_does_not_exist_at_all', quantity: 1 }],
    })

    await expect(attempt).rejects.toBeInstanceOf(PaymentProviderError)
    await expect(attempt).rejects.toMatchObject({ code: 'checkout_failed' })
  }, 60_000)

  it('raises PaymentProviderError, not a bare fetch error, on a key the API rejects', async () => {
    const attempt = provider('abc_dev_notarealkeyatall').createCheckout({
      items: [{ ref: required('ABACATEPAY_TEST_PRODUCT_ID'), quantity: 1 }],
    })

    await expect(attempt).rejects.toBeInstanceOf(PaymentProviderError)
  }, 60_000)
})

describeLive(ABACATEPAY, 'PIX, through the capability guard', () => {
  it('issues an inline PIX charge with a payable BR Code', async () => {
    const p = provider()
    // The guard is not decoration: this is the line that would not compile
    // against Stripe, which has no inline PIX at all.
    expect(supportsPix(p)).toBe(true)
    if (!supportsPix(p)) return

    const charge = await p.createPixCharge({
      amountInCents: 500,
      description: `theokit-e2e ${runMarker()}`,
    })

    expect(charge.provider).toBe('abacatepay')
    expect(charge.id).toMatch(/^pix_char_[A-Za-z0-9]+$/)
    // A BR Code is an EMV payload: it opens with the payload-format indicator
    // `0002` and names the PIX domain. Asserting that rather than "truthy" is
    // what would catch a response change that still returned a string.
    expect(charge.brCode).toMatch(/^00020101/)
    expect(charge.brCode).toContain('BR.GOV.BCB.PIX')
    // Sandbox marks its own payloads, which is a second, independent
    // confirmation that no real money is in play.
    expect(charge.brCode).toContain('devmode-pix-')
    expect(charge.brCodeBase64).toMatch(/^data:image\/png;base64,/)
  }, 60_000)

  it('rejects a non-positive amount before calling the API', async () => {
    const p = provider()
    if (!supportsPix(p)) throw new Error('unreachable')

    await expect(p.createPixCharge({ amountInCents: 0 })).rejects.toMatchObject({
      code: 'invalid_amount',
    })
  }, 30_000)
})

describeLive(ABACATEPAY, 'status reconciliation', () => {
  it('reads a hosted checkout from /checkouts/get — the route the docs get wrong', async () => {
    // AbacatePay's docs name `/checkouts/one`. Measured unauthenticated, that
    // path answers 400 exactly like a route that does not exist, while
    // `/checkouts/get` answers 401. This assertion is what proves the provider
    // picked the one that works.
    const created = await provider().createCheckout({
      items: [{ ref: required('ABACATEPAY_TEST_PRODUCT_ID'), quantity: 1 }],
    })

    const status = await provider().retrieveCheckout(created.id)

    expect(status).toMatchObject({
      id: created.id,
      status: 'pending',
      provider: 'abacatepay',
      amountInCents: 500,
      currency: 'BRL',
      amountRefundedInCents: 0,
    })
  }, 60_000)

  it('reads a transparent charge from /transparents/check, and sees a simulated payment land', async () => {
    // The reconciliation story end to end: create, observe pending, pay, observe
    // paid. Without the second read this would only prove the first.
    const p = provider()
    if (!supportsPix(p)) throw new Error('unreachable')
    const charge = await p.createPixCharge({ amountInCents: 500 })

    expect((await p.retrieveCheckout(charge.id)).status).toBe('pending')
    await simulatePayment(charge.id)
    expect((await p.retrieveCheckout(charge.id)).status).toBe('paid')
  }, 90_000)

  it('refuses a reference whose prefix names no resource, rather than guessing an endpoint', async () => {
    await expect(provider().retrieveCheckout('whatever_123')).rejects.toMatchObject({
      code: 'unknown_reference',
    })
  }, 30_000)
})

describeLive(ABACATEPAY, 'refund routing', () => {
  it('refunds a transparent charge in full, through the route the docs deny it needs', async () => {
    // The measurement that restored deleted code, and then corrected the parsing
    // of its own success. `/checkouts/refund` rejects a pix_char_ id with a
    // routing message; `/transparents/refund` accepts it and completes.
    //
    // The response shape is not the documented one either. Docs:
    // `{ refundPublicId }`. Reality:
    // `{ id, status: "COMPLETE", amount, originalId, createdAt }`. Reading only
    // the documented key made the provider throw `refund_failed` on every
    // successful refund — invisible to a unit test whose fake was written from
    // the same docs.
    const p = provider()
    if (!supportsPix(p)) throw new Error('unreachable')
    const charge = await p.createPixCharge({ amountInCents: 500 })
    await simulatePayment(charge.id)

    const refund = await p.refund({ reference: charge.id, reason: `theokit-e2e ${runMarker()}` })

    expect(refund.provider).toBe('abacatepay')
    expect(refund.id).toMatch(/^tran_[A-Za-z0-9]+$/)
    expect(refund.amountInCents).toBe(500)
    // Re-read from the API rather than trusting our own return value: asserting
    // the response we just parsed would only prove the code agrees with itself.
    expect((await p.retrieveCheckout(charge.id)).status).toBe('refunded')
  }, 120_000)

  it('surfaces an insufficient-balance refusal as our typed error', async () => {
    // Measured: a devMode simulated payment moves the charge to PAID without
    // adding spendable balance, so refunding twice in a row hits
    // "Saldo insuficiente para realizar o reembolso". Asserting BOTH the success
    // above and this refusal is what shows the routing is right in the first
    // place — a wrong route answers with the other route's name instead.
    const p = provider()
    if (!supportsPix(p)) throw new Error('unreachable')
    const charge = await p.createPixCharge({ amountInCents: 500 })
    await simulatePayment(charge.id)
    await p.refund({ reference: charge.id })

    const second = p.refund({ reference: charge.id })
    await expect(second).rejects.toBeInstanceOf(PaymentProviderError)
    await expect(second).rejects.toThrow(/[Ss]aldo insuficiente|já foi|reembolsad/i)
  }, 120_000)

  it('reports a hosted checkout that was never paid as not found, not as refunded', async () => {
    const created = await provider().createCheckout({
      items: [{ ref: required('ABACATEPAY_TEST_PRODUCT_ID'), quantity: 1 }],
    })

    const attempt = provider().refund({ reference: created.id })

    await expect(attempt).rejects.toMatchObject({ code: 'refund_failed' })
  }, 60_000)
})
