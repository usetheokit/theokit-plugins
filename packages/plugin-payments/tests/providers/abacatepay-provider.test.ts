/**
 * AbacatePayProvider — the neutral contract over AbacatePay's REST API.
 *
 * Two behaviours here exist because of how this specific API behaves, and would
 * be invisible in a generic HTTP test:
 *
 *   - it can answer HTTP 200 with `error` set, so `res.ok` alone is not the
 *     verdict and checking only the status would hand back `undefined` as a
 *     checkout URL;
 *   - its per-merchant secret arrives in the query string, not a header, so
 *     verification needs the request URL and must refuse without it.
 *
 * Shapes verified against https://docs.abacatepay.com on 2026-08-18.
 */
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { AbacatePayProvider, type FetchLike } from '../../src/providers/abacatepay.js'
import { PaymentProviderError, WebhookSignatureError } from '../../src/provider-types.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function makeFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> & FetchLike {
  return vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)))
}

const API_KEY = 'abc_test_key'

describe('AbacatePayProvider.createCheckout', () => {
  it('posts to /checkouts/create with bearer auth and returns the redirect URL', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        data: { id: 'bill_abc123', url: 'https://app.abacatepay.com/pay/bill_abc123' },
        success: true,
        error: null,
      }),
    )
    const provider = AbacatePayProvider({ apiKey: API_KEY, fetchImpl })

    const result = await provider.createCheckout({
      items: [{ ref: 'prod_x', quantity: 3 }],
      currency: 'BRL',
      successUrl: 'https://loja.example/obrigado',
      cancelUrl: 'https://loja.example/voltar',
      customerRef: 'cust_1',
      metadata: { pedido: '99' },
    })

    expect(result).toMatchObject({
      id: 'bill_abc123',
      url: 'https://app.abacatepay.com/pay/bill_abc123',
      provider: 'abacatepay',
    })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.abacatepay.com/v2/checkouts/create')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`)
    expect(JSON.parse(init.body as string)).toEqual({
      items: [{ id: 'prod_x', quantity: 3 }],
      completionUrl: 'https://loja.example/obrigado',
      returnUrl: 'https://loja.example/voltar',
      customerId: 'cust_1',
      metadata: { pedido: '99' },
    })
  })

  it('posts a subscription checkout to /subscriptions/create, not /checkouts/create', async () => {
    // #39. Same payload, different endpoint — the provider hides that, so the
    // caller writes `mode: 'subscription'` and nothing else changes.
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'bill_sub', url: 'https://pay/sub' }, error: null }),
    )
    const result = await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createCheckout({
      items: [{ ref: 'prod_monthly', quantity: 1 }],
      mode: 'subscription',
    })

    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://api.abacatepay.com/v2/subscriptions/create',
    )
    expect(result.url).toBe('https://pay/sub')
  })

  it('refuses a multi-item subscription with the rule, not with a 400 from the API', async () => {
    // AbacatePay accepts exactly one item on a subscription checkout, because
    // the cycle comes from the product. Stripe has no such limit, so the check
    // belongs to the provider and not to the neutral contract.
    const fetchImpl = makeFetch(() => jsonResponse({ data: {}, error: null }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createCheckout({
        items: [
          { ref: 'prod_a', quantity: 1 },
          { ref: 'prod_b', quantity: 1 },
        ],
        mode: 'subscription',
      }),
    ).rejects.toMatchObject({ code: 'subscription_requires_single_item' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('still posts a one-off checkout to /checkouts/create', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'bill_1', url: 'https://pay/1' }, error: null }),
    )
    await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createCheckout({
      items: [{ ref: 'prod_x', quantity: 1 }],
    })
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://api.abacatepay.com/v2/checkouts/create',
    )
  })

  it('refuses a non-BRL charge instead of letting the amount be reinterpreted', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ data: {}, error: null }))
    const provider = AbacatePayProvider({ apiKey: API_KEY, fetchImpl })

    await expect(
      provider.createCheckout({ items: [{ ref: 'prod_x', quantity: 1 }], currency: 'USD' }),
    ).rejects.toMatchObject({ name: 'PaymentProviderError', code: 'unsupported_currency' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never sends idempotencyKey, because AbacatePay documents no mechanism that would honour it', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'bill_1', url: 'https://pay/1' }, error: null }),
    )
    await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createCheckout({
      items: [{ ref: 'prod_x', quantity: 1 }],
      idempotencyKey: 'order-42',
    })
    const body = (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string
    expect(body).not.toContain('order-42')
  })

  it('rejects an empty basket before spending a round trip', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ data: {}, error: null }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createCheckout({ items: [] }),
    ).rejects.toMatchObject({ code: 'empty_checkout' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('treats HTTP 200 with a non-null error as a failure, not a success', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: null, success: false, error: 'Produto não encontrado' }, 200),
    )
    const err = await AbacatePayProvider({ apiKey: API_KEY, fetchImpl })
      .createCheckout({ items: [{ ref: 'prod_missing', quantity: 1 }] })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PaymentProviderError)
    expect((err as PaymentProviderError).message).toContain('Produto não encontrado')
  })

  it('reports a non-JSON body without pretending it parsed', async () => {
    const fetchImpl = makeFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createCheckout({
        items: [{ ref: 'p', quantity: 1 }],
      }),
    ).rejects.toThrow(/not JSON/)
  })

  it('distinguishes a transport failure from a refusal', async () => {
    const fetchImpl = makeFetch(() => {
      throw new Error('ECONNREFUSED')
    })
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createCheckout({
        items: [{ ref: 'p', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'network_error' })
  })

  it('refuses a checkout that came back without a url', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ data: { id: 'bill_1' }, error: null }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createCheckout({
        items: [{ ref: 'p', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'missing_checkout_url' })
  })

  it('honours a custom baseUrl without doubling the slash', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'b', url: 'https://pay/1' }, error: null }),
    )
    await AbacatePayProvider({
      apiKey: API_KEY,
      baseUrl: 'https://sandbox.example/v2/',
      fetchImpl,
    }).createCheckout({ items: [{ ref: 'p', quantity: 1 }] })
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://sandbox.example/v2/checkouts/create',
    )
  })

  it('requires an apiKey', () => {
    expect(() => AbacatePayProvider({ apiKey: '' })).toThrow(/requires \{ apiKey \}/)
  })
})

describe('AbacatePayProvider.createPixCharge', () => {
  it('posts method PIX with the amount in centavos and returns the BR Code', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        data: {
          id: 'pix_char_abc',
          brCode: '00020101021226...6304ABCD',
          brCodeBase64: 'data:image/png;base64,iVBORw0KG',
        },
        error: null,
      }),
    )
    const provider = AbacatePayProvider({ apiKey: API_KEY, fetchImpl })

    const charge = await provider.createPixCharge({
      amountInCents: 10_000,
      description: 'Pedido 99',
      expiresInSeconds: 3600,
      customer: { name: 'Daniel Lima', email: 'daniel@example.com' },
    })

    expect(charge).toMatchObject({
      id: 'pix_char_abc',
      brCode: '00020101021226...6304ABCD',
      brCodeBase64: 'data:image/png;base64,iVBORw0KG',
      provider: 'abacatepay',
    })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.abacatepay.com/v2/transparents/create')
    expect(JSON.parse(init.body as string)).toEqual({
      method: 'PIX',
      data: {
        amount: 10_000,
        description: 'Pedido 99',
        expiresIn: 3600,
        customer: { name: 'Daniel Lima', email: 'daniel@example.com' },
      },
    })
  })

  it.each([[0], [-100], [10.5]])('rejects %s centavos before calling the API', async (amount) => {
    const fetchImpl = makeFetch(() => jsonResponse({ data: {}, error: null }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createPixCharge({
        amountInCents: amount,
      }),
    ).rejects.toMatchObject({ code: 'invalid_amount' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a charge with no brCode — nothing could be paid with it', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ data: { id: 'pix_1' }, error: null }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).createPixCharge({ amountInCents: 500 }),
    ).rejects.toMatchObject({ code: 'missing_br_code' })
  })
})

describe('AbacatePayProvider.verifyWebhook', () => {
  const SECRET = 'segredo-do-lojista'
  const body = JSON.stringify({ id: 'log_abc123', event: 'checkout.completed', apiVersion: 2 })
  const goodUrl = `https://loja.example/webhook?webhookSecret=${SECRET}`

  function sign(raw: string, key: string): string {
    return createHmac('sha256', key).update(Buffer.from(raw, 'utf8')).digest('base64')
  }

  it('accepts a delivery whose query secret matches, and normalises the event', async () => {
    const provider = AbacatePayProvider({ apiKey: API_KEY, webhookSecret: SECRET })
    const event = await provider.verifyWebhook({ rawBody: body, headers: {}, url: goodUrl })

    expect(event).toMatchObject({
      type: 'checkout.completed',
      id: 'log_abc123',
      providerEventType: 'checkout.completed',
      provider: 'abacatepay',
    })
  })

  it.each([
    ['transparent.completed', 'checkout.completed'],
    ['checkout.refunded', 'payment.refunded'],
    ['transparent.refunded', 'payment.refunded'],
    ['checkout.disputed', 'payment.disputed'],
    ['transparent.disputed', 'payment.disputed'],
  ])('maps %s to %s', async (abacateEvent, expected) => {
    const raw = JSON.stringify({ id: 'log_1', event: abacateEvent })
    const provider = AbacatePayProvider({ apiKey: API_KEY, webhookSecret: SECRET })
    const event = await provider.verifyWebhook({ rawBody: raw, headers: {}, url: goodUrl })
    expect(event.type).toBe(expected)
  })

  it.each([['checkout.lost'], ['subscription.renewed'], ['payout.failed']])(
    'passes %s through as unknown rather than inventing a mapping for it',
    async (abacateEvent) => {
      const raw = JSON.stringify({ id: 'log_2', event: abacateEvent })
      const provider = AbacatePayProvider({ apiKey: API_KEY, webhookSecret: SECRET })
      const event = await provider.verifyWebhook({ rawBody: raw, headers: {}, url: goodUrl })
      expect(event.type).toBe('unknown')
      expect(event.providerEventType).toBe(abacateEvent)
    },
  )

  it('rejects a wrong query secret', async () => {
    const provider = AbacatePayProvider({ apiKey: API_KEY, webhookSecret: SECRET })
    await expect(
      provider.verifyWebhook({
        rawBody: body,
        headers: {},
        url: 'https://loja.example/webhook?webhookSecret=chutado',
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })

  it('rejects a delivery with no query secret at all', async () => {
    const provider = AbacatePayProvider({ apiKey: API_KEY, webhookSecret: SECRET })
    await expect(
      provider.verifyWebhook({ rawBody: body, headers: {}, url: 'https://loja.example/webhook' }),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })

  it('refuses to verify without the request URL instead of falling back to no check', async () => {
    const provider = AbacatePayProvider({ apiKey: API_KEY, webhookSecret: SECRET })
    await expect(provider.verifyWebhook({ rawBody: body, headers: {} })).rejects.toThrow(
      /url is required for AbacatePay/,
    )
  })

  it('fails loudly when no webhookSecret was configured', async () => {
    const provider = AbacatePayProvider({ apiKey: API_KEY })
    await expect(
      provider.verifyWebhook({ rawBody: body, headers: {}, url: goodUrl }),
    ).rejects.toMatchObject({ code: 'missing_webhook_secret' })
  })

  describe('with an opt-in signatureKey', () => {
    const KEY = 'chave-hmac'

    it('accepts a correctly signed body', async () => {
      const provider = AbacatePayProvider({
        apiKey: API_KEY,
        webhookSecret: SECRET,
        signatureKey: KEY,
      })
      const event = await provider.verifyWebhook({
        rawBody: body,
        headers: { 'x-webhook-signature': sign(body, KEY) },
        url: goodUrl,
      })
      expect(event.type).toBe('checkout.completed')
    })

    it('rejects a body that was altered after signing', async () => {
      const provider = AbacatePayProvider({
        apiKey: API_KEY,
        webhookSecret: SECRET,
        signatureKey: KEY,
      })
      await expect(
        provider.verifyWebhook({
          rawBody: JSON.stringify({ id: 'log_abc123', event: 'checkout.completed', extra: 1 }),
          headers: { 'x-webhook-signature': sign(body, KEY) },
          url: goodUrl,
        }),
      ).rejects.toBeInstanceOf(WebhookSignatureError)
    })

    it('rejects a delivery carrying no signature header', async () => {
      const provider = AbacatePayProvider({
        apiKey: API_KEY,
        webhookSecret: SECRET,
        signatureKey: KEY,
      })
      await expect(
        provider.verifyWebhook({ rawBody: body, headers: {}, url: goodUrl }),
      ).rejects.toThrow(/no X-Webhook-Signature header/)
    })

    it('does not check the header when signatureKey is unset — the documented default', async () => {
      const provider = AbacatePayProvider({ apiKey: API_KEY, webhookSecret: SECRET })
      const event = await provider.verifyWebhook({
        rawBody: body,
        headers: { 'x-webhook-signature': 'garbage' },
        url: goodUrl,
      })
      expect(event.type).toBe('checkout.completed')
    })
  })

  it('reports a body that passed verification but is not JSON', async () => {
    const provider = AbacatePayProvider({ apiKey: API_KEY, webhookSecret: SECRET })
    await expect(
      provider.verifyWebhook({ rawBody: 'not json', headers: {}, url: goodUrl }),
    ).rejects.toMatchObject({ code: 'malformed_webhook_body' })
  })
})

describe('AbacatePayProvider.retrieveCheckout', () => {
  it('reads a hosted checkout from /checkouts/get — NOT /checkouts/one', async () => {
    // AbacatePay's own docs disagree: the llms index names /checkouts/one, the
    // OpenAPI on the same page names /checkouts/get. Measured unauthenticated
    // 2026-08-18, /checkouts/get answers 401 (exists, needs auth) while
    // /checkouts/one answers 400 — identical to a route that does not exist.
    // Following the index would have shipped a status check that 400s always.
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'bill_1', status: 'PAID', amount: 10_000 }, error: null }),
    )
    const status = await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).retrieveCheckout(
      'bill_1',
    )

    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://api.abacatepay.com/v2/checkouts/get?id=bill_1',
    )
    expect(status).toMatchObject({
      id: 'bill_1',
      status: 'paid',
      provider: 'abacatepay',
      amountInCents: 10_000,
      currency: 'BRL',
    })
  })

  it('reads an inline PIX charge from /transparents/check', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'pix_char_1', status: 'PENDING', amount: 500 }, error: null }),
    )
    await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).retrieveCheckout('pix_char_1')
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://api.abacatepay.com/v2/transparents/check?id=pix_char_1',
    )
  })

  it.each([
    ['PENDING', 'pending'],
    ['PAID', 'paid'],
    ['EXPIRED', 'expired'],
    ['CANCELLED', 'cancelled'],
    ['REFUNDED', 'refunded'],
  ])('maps %s to %s', async (api, expected) => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'bill_1', status: api, amount: 100 }, error: null }),
    )
    const status = await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).retrieveCheckout(
      'bill_1',
    )
    expect(status.status).toBe(expected)
  })

  it('reports the full amount as refunded, because AbacatePay refunds integrally', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'bill_1', status: 'REFUNDED', amount: 7500 }, error: null }),
    )
    const status = await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).retrieveCheckout(
      'bill_1',
    )
    expect(status.amountRefundedInCents).toBe(7500)
  })

  it('refuses a reference whose prefix matches no resource, rather than guessing an endpoint', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ data: {}, error: null }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).retrieveCheckout('whatever_123'),
    ).rejects.toMatchObject({ code: 'unknown_reference' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('passes an unrecognised status through as unknown instead of inventing one', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'bill_1', status: 'SOMETHING_NEW' }, error: null }),
    )
    const status = await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).retrieveCheckout(
      'bill_1',
    )
    expect(status.status).toBe('unknown')
  })
})

describe('AbacatePayProvider.refund', () => {
  it('posts the checkout id to /checkouts/refund and returns the refund id', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { refundPublicId: 'tran_refund789' }, error: null }),
    )
    const result = await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).refund({
      reference: 'bill_1',
      reason: 'Pedido cancelado pelo cliente.',
    })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.abacatepay.com/v2/checkouts/refund')
    expect(JSON.parse(init.body as string)).toEqual({
      id: 'bill_1',
      reason: 'Pedido cancelado pelo cliente.',
    })
    expect(result).toMatchObject({ id: 'tran_refund789', provider: 'abacatepay' })
  })

  it('routes a PIX charge to /transparents/refund', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { refundPublicId: 'tran_r' }, error: null }),
    )
    await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).refund({ reference: 'pix_char_1' })
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://api.abacatepay.com/v2/transparents/refund',
    )
  })

  it('never sends an idempotency key, because the endpoint dedupes on the resource id', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { refundPublicId: 'tran_r' }, error: null }),
    )
    await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).refund({
      reference: 'bill_1',
      idempotencyKey: 'should-not-travel',
    })
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string).not.toContain(
      'should-not-travel',
    )
  })

  it('refuses a success with no refundPublicId — there would be nothing to reconcile', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ data: {}, error: null }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).refund({ reference: 'bill_1' }),
    ).rejects.toMatchObject({ code: 'refund_failed' })
  })

  it('does NOT advertise partial refunds, because AbacatePay has none', async () => {
    const { supportsPartialRefund } = await import('../../src/provider.js')
    expect(supportsPartialRefund(AbacatePayProvider({ apiKey: API_KEY }))).toBe(false)
  })
})

describe('AbacatePayProvider.cancelSubscription', () => {
  it('posts the subs_ id to /subscriptions/cancel', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'subs_1', status: 'CANCELLED' }, error: null }),
    )
    const result = await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).cancelSubscription(
      'subs_1',
    )

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.abacatepay.com/v2/subscriptions/cancel')
    expect(JSON.parse(init.body as string)).toEqual({ id: 'subs_1' })
    expect(result).toMatchObject({ id: 'subs_1', status: 'cancelled', provider: 'abacatepay' })
  })

  it('refuses a checkout id, because AbacatePay documents no way to resolve one', async () => {
    // Unlike Stripe, whose session carries `subscription`, AbacatePay has no
    // documented bill_ -> subs_ lookup. Guessing would produce a 4xx that reads
    // like the subscription never existed.
    const fetchImpl = makeFetch(() => jsonResponse({ data: {}, error: null }))
    await expect(
      AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).cancelSubscription('bill_1'),
    ).rejects.toMatchObject({ code: 'unknown_reference' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not claim cancellation when the API reports another status', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ data: { id: 'subs_1', status: 'PENDING' }, error: null }),
    )
    expect(
      (await AbacatePayProvider({ apiKey: API_KEY, fetchImpl }).cancelSubscription('subs_1'))
        .status,
    ).toBe('unknown')
  })
})
