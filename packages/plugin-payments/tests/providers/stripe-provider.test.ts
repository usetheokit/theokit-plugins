/**
 * StripeProvider — the neutral contract over Stripe.
 *
 * The assertion that earns its place here is the idempotency one. In
 * `@theokit/plugin-email` the same key was passed inside the payload instead of
 * as a request option (#37), which type-checked, shipped, and deduplicated
 * nothing for months. Stripe has the identical trap: `checkout.sessions.create`
 * takes params first and options second, and putting the key in params is
 * silently accepted.
 */
import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

import { StripeProvider } from '../../src/providers/stripe.js'
import { PaymentProviderError, WebhookSignatureError } from '../../src/provider-types.js'

function makeClient(opts: {
  session?: Partial<Stripe.Checkout.Session>
  createImpl?: (...args: unknown[]) => unknown
  constructEvent?: (...args: unknown[]) => unknown
}): { client: Stripe; create: ReturnType<typeof vi.fn>; construct: ReturnType<typeof vi.fn> } {
  const create = vi.fn(
    opts.createImpl ??
      ((..._args: unknown[]) =>
        Promise.resolve({ id: 'cs_1', url: 'https://checkout.stripe.com/x', ...opts.session })),
  )
  const construct = vi.fn(
    opts.constructEvent ??
      ((..._args: unknown[]) => ({ id: 'evt_1', type: 'checkout.session.completed' })),
  )
  const client = {
    checkout: { sessions: { create } },
    webhooks: { constructEvent: construct },
  } as unknown as Stripe
  return { client, create, construct }
}

describe('StripeProvider.createCheckout', () => {
  it('maps item refs to Stripe price ids and returns the hosted URL', async () => {
    const { client, create } = makeClient({})
    const provider = StripeProvider({ client })

    const result = await provider.createCheckout({
      items: [
        { ref: 'price_abc', quantity: 2 },
        { ref: 'price_def', quantity: 1 },
      ],
      successUrl: 'https://shop.example/ok',
      cancelUrl: 'https://shop.example/no',
      metadata: { orderId: '42' },
    })

    expect(result).toEqual({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/x',
      provider: 'stripe',
      raw: { id: 'cs_1', url: 'https://checkout.stripe.com/x' },
    })
    const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams
    expect(params.line_items).toEqual([
      { price: 'price_abc', quantity: 2 },
      { price: 'price_def', quantity: 1 },
    ])
    expect(params.success_url).toBe('https://shop.example/ok')
    expect(params.cancel_url).toBe('https://shop.example/no')
    expect(params.metadata).toEqual({ orderId: '42' })
  })

  it('sends idempotencyKey as a REQUEST OPTION, not inside the params (the #37 trap)', async () => {
    const { client, create } = makeClient({})
    const provider = StripeProvider({ client })

    await provider.createCheckout({
      items: [{ ref: 'price_abc', quantity: 1 }],
      idempotencyKey: 'order-42',
    })

    const [params, options] = create.mock.calls[0] as [
      Record<string, unknown>,
      Stripe.RequestOptions | undefined,
    ]
    expect(options).toEqual({ idempotencyKey: 'order-42' })
    expect(params).not.toHaveProperty('idempotencyKey')
    expect(JSON.stringify(params)).not.toContain('order-42')
  })

  it('omits the options argument entirely when no key was given', async () => {
    const { client, create } = makeClient({})
    await StripeProvider({ client }).createCheckout({ items: [{ ref: 'price_a', quantity: 1 }] })
    expect(create.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('lowercases the currency, because Stripe rejects uppercase ISO codes', async () => {
    const { client, create } = makeClient({})
    await StripeProvider({ client }).createCheckout({
      items: [{ ref: 'price_a', quantity: 1 }],
      currency: 'USD',
    })
    const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams
    expect(params.currency).toBe('usd')
  })

  it('refuses a session with no URL instead of returning an empty redirect', async () => {
    const { client } = makeClient({ session: { url: null } })
    await expect(
      StripeProvider({ client }).createCheckout({ items: [{ ref: 'price_a', quantity: 1 }] }),
    ).rejects.toMatchObject({ name: 'PaymentProviderError', code: 'missing_checkout_url' })
  })

  it('wraps a Stripe API failure as PaymentProviderError, keeping the cause', async () => {
    const boom = new Error('No such price: price_nope')
    const { client } = makeClient({ createImpl: () => Promise.reject(boom) })

    const err = await StripeProvider({ client })
      .createCheckout({ items: [{ ref: 'price_nope', quantity: 1 }] })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PaymentProviderError)
    expect((err as PaymentProviderError).code).toBe('checkout_failed')
    expect((err as PaymentProviderError).cause).toBe(boom)
  })

  it('requires a client', () => {
    expect(() => StripeProvider({ client: undefined as unknown as Stripe })).toThrow(
      /requires \{ client \}/,
    )
  })
})

describe('StripeProvider.verifyWebhook', () => {
  const req = {
    rawBody: '{"id":"evt_1"}',
    headers: { 'stripe-signature': 't=1,v1=abc' },
  }

  it('normalises a known event while keeping Stripe’s own name and payload', async () => {
    const { client, construct } = makeClient({})
    const event = await StripeProvider({ client, webhookSecret: 'whsec_x' }).verifyWebhook(req)

    expect(event).toEqual({
      type: 'checkout.completed',
      id: 'evt_1',
      providerEventType: 'checkout.session.completed',
      provider: 'stripe',
      raw: { id: 'evt_1', type: 'checkout.session.completed' },
    })
    expect(construct).toHaveBeenCalledWith('{"id":"evt_1"}', 't=1,v1=abc', 'whsec_x')
  })

  it.each([
    ['checkout.session.expired', 'checkout.expired'],
    ['charge.refunded', 'payment.refunded'],
    ['charge.dispute.created', 'payment.disputed'],
    ['payment_intent.payment_failed', 'payment.failed'],
  ])('maps %s to %s', async (stripeType, expected) => {
    const { client } = makeClient({
      constructEvent: () => ({ id: 'evt_2', type: stripeType }),
    })
    const event = await StripeProvider({ client, webhookSecret: 'whsec_x' }).verifyWebhook(req)
    expect(event.type).toBe(expected)
  })

  it('passes an unmapped event through as unknown WITHOUT losing its real name', async () => {
    const { client } = makeClient({
      constructEvent: () => ({ id: 'evt_3', type: 'invoice.upcoming' }),
    })
    const event = await StripeProvider({ client, webhookSecret: 'whsec_x' }).verifyWebhook(req)
    expect(event.type).toBe('unknown')
    expect(event.providerEventType).toBe('invoice.upcoming')
  })

  it('accepts the header under its capitalised spelling too', async () => {
    const { client, construct } = makeClient({})
    await StripeProvider({ client, webhookSecret: 'whsec_x' }).verifyWebhook({
      rawBody: '{}',
      headers: { 'Stripe-Signature': 't=2,v1=zzz' },
    })
    expect(construct).toHaveBeenCalledWith('{}', 't=2,v1=zzz', 'whsec_x')
  })

  it('rejects a request with no signature header', async () => {
    const { client } = makeClient({})
    await expect(
      StripeProvider({ client, webhookSecret: 'whsec_x' }).verifyWebhook({
        rawBody: '{}',
        headers: {},
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })

  it('turns a constructEvent failure into WebhookSignatureError', async () => {
    const { client } = makeClient({
      constructEvent: () => {
        throw new Error('No signatures found matching the expected signature')
      },
    })
    await expect(
      StripeProvider({ client, webhookSecret: 'whsec_x' }).verifyWebhook(req),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })

  it('fails loudly when no webhookSecret was configured, rather than accepting anything', async () => {
    const { client } = makeClient({})
    await expect(StripeProvider({ client }).verifyWebhook(req)).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'missing_webhook_secret',
    })
  })
})
