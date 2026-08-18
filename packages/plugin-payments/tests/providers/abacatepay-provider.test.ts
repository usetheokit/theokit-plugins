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
