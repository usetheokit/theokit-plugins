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
  retrieveImpl?: (...args: unknown[]) => unknown
  refundImpl?: (...args: unknown[]) => unknown
  cancelImpl?: (...args: unknown[]) => unknown
}): {
  client: Stripe
  create: ReturnType<typeof vi.fn>
  construct: ReturnType<typeof vi.fn>
  retrieve: ReturnType<typeof vi.fn>
  refundCreate: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
} {
  const create = vi.fn(
    opts.createImpl ??
      ((..._args: unknown[]) =>
        Promise.resolve({ id: 'cs_1', url: 'https://checkout.stripe.com/x', ...opts.session })),
  )
  const construct = vi.fn(
    opts.constructEvent ??
      ((..._args: unknown[]) => ({ id: 'evt_1', type: 'checkout.session.completed' })),
  )
  const retrieve = vi.fn(
    opts.retrieveImpl ??
      ((..._args: unknown[]) =>
        Promise.resolve({
          id: 'cs_1',
          status: 'open',
          payment_status: 'unpaid',
          amount_total: 500,
          currency: 'usd',
          payment_intent: null,
          ...opts.session,
        })),
  )
  const refundCreate = vi.fn(
    opts.refundImpl ??
      ((..._args: unknown[]) => Promise.resolve({ id: 're_1', amount: 500, status: 'succeeded' })),
  )
  const cancel = vi.fn(
    opts.cancelImpl ??
      ((..._args: unknown[]) => Promise.resolve({ id: 'sub_1', status: 'canceled' })),
  )
  const client = {
    checkout: { sessions: { create, retrieve } },
    webhooks: { constructEvent: construct },
    refunds: { create: refundCreate },
    subscriptions: { cancel },
  } as unknown as Stripe
  return { client, create, construct, retrieve, refundCreate, cancel }
}

describe('StripeProvider.createCheckout', () => {
  it('sends ui_mode and return_url for an embedded request, and no success_url', async () => {
    // The exclusion is Stripe's, measured live: "`success_url` is not supported with
    // `ui_mode: embedded`". Asserting on the PARAMS is what catches a build that sends both — the
    // response would look fine in a stub, and the real API would refuse it.
    const { client, create } = makeClient({
      session: { url: null, client_secret: 'cs_1_secret_abc' },
    })
    const provider = StripeProvider({ client })

    await provider.createCheckout({
      items: [{ ref: 'price_abc', quantity: 1 }],
      uiMode: 'embedded',
      returnUrl: 'https://shop.example/return?s={CHECKOUT_SESSION_ID}',
    })

    const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams
    expect(params.ui_mode).toBe('embedded')
    expect(params.return_url).toBe('https://shop.example/return?s={CHECKOUT_SESSION_ID}')
    expect(params.success_url, 'Stripe refuses this combination outright').toBeUndefined()
    expect(params.cancel_url).toBeUndefined()
  })

  it('returns the client secret for an embedded session', async () => {
    const { client } = makeClient({
      session: { url: null, client_secret: 'cs_1_secret_abc' },
    })
    const provider = StripeProvider({ client })

    const result = await provider.createCheckout({
      items: [{ ref: 'price_abc', quantity: 1 }],
      uiMode: 'embedded',
      returnUrl: 'https://shop.example/return',
    })

    expect(result.uiMode).toBe('embedded')
    expect(result.uiMode === 'embedded' ? result.clientSecret : null).toBe('cs_1_secret_abc')
  })

  it('fails by name when an embedded session comes back without a client secret', async () => {
    // The negative case. Returning an empty string would hand the consumer something to pass to a
    // client SDK that will fail somewhere less informative (`rules/error-handling.md` § 2).
    const { client } = makeClient({ session: { url: null, client_secret: null } })
    const provider = StripeProvider({ client })

    await expect(
      provider.createCheckout({
        items: [{ ref: 'price_abc', quantity: 1 }],
        uiMode: 'embedded',
        returnUrl: 'https://shop.example/return',
      }),
    ).rejects.toThrow(/client secret|client_secret/i)
  })

  it('does not send ui_mode at all for a hosted request', async () => {
    // Absence matters: sending `ui_mode: 'hosted'` explicitly is valid today but pins this package
    // to a default Stripe owns. Staying silent keeps the hosted request byte-identical to the one
    // every existing caller already makes.
    const { client, create } = makeClient({})
    const provider = StripeProvider({ client })

    await provider.createCheckout({
      items: [{ ref: 'price_abc', quantity: 1 }],
      successUrl: 'https://shop.example/ok',
    })

    const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams
    expect(params.ui_mode).toBeUndefined()
    expect(params.return_url).toBeUndefined()
  })

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

    // `uiMode` is part of the envelope now: the result is discriminated because an embedded session
    // has no URL at all, and this exact `toEqual` is what noticed the field appearing — which is
    // the point of asserting the whole shape rather than picking fields off it.
    expect(result).toEqual({
      id: 'cs_1',
      uiMode: 'hosted',
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

  it('defaults to payment mode when the caller says nothing', async () => {
    const { client, create } = makeClient({})
    await StripeProvider({ client }).createCheckout({ items: [{ ref: 'price_a', quantity: 1 }] })
    expect((create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams).mode).toBe('payment')
  })

  it('passes subscription mode through to the same endpoint', async () => {
    // #39: mode used to be hardcoded to 'payment', so the neutral contract could
    // not start a recurring charge at all — on either provider.
    const { client, create } = makeClient({})
    await StripeProvider({ client }).createCheckout({
      items: [{ ref: 'price_monthly', quantity: 1 }],
      mode: 'subscription',
    })
    expect((create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams).mode).toBe(
      'subscription',
    )
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

describe('StripeProvider.retrieveCheckout', () => {
  it('asks for the expansion that makes a refund visible from a session', async () => {
    // Without expand, "was this refunded?" is a second round trip the caller has
    // to know to make — and most will not, so the status would quietly be wrong.
    const { client, retrieve } = makeClient({})
    await StripeProvider({ client }).retrieveCheckout('cs_1')
    expect(retrieve).toHaveBeenCalledWith('cs_1', {
      expand: ['payment_intent.latest_charge'],
    })
  })

  it('reports an unpaid open session as pending, not as paid', async () => {
    const { client } = makeClient({})
    const status = await StripeProvider({ client }).retrieveCheckout('cs_1')
    expect(status).toMatchObject({
      id: 'cs_1',
      status: 'pending',
      provider: 'stripe',
      amountInCents: 500,
      amountRefundedInCents: 0,
      currency: 'USD',
    })
  })

  it('does NOT report a complete-but-unpaid session as paid', async () => {
    // A session can be complete while an asynchronous method is still settling.
    // Reading `status` alone here is what fulfils an unpaid order.
    const { client } = makeClient({ session: { status: 'complete', payment_status: 'unpaid' } })
    expect((await StripeProvider({ client }).retrieveCheckout('cs_1')).status).toBe('pending')
  })

  it.each([
    [{ status: 'complete', payment_status: 'paid' }, 'paid'],
    [{ status: 'complete', payment_status: 'no_payment_required' }, 'paid'],
    [{ status: 'expired', payment_status: 'unpaid' }, 'expired'],
  ])('maps %o to %s', async (session, expected) => {
    const { client } = makeClient({ session: session as Partial<Stripe.Checkout.Session> })
    expect((await StripeProvider({ client }).retrieveCheckout('cs_1')).status).toBe(expected)
  })

  it('reports refunded, and how much, when the expanded charge says so', async () => {
    const { client } = makeClient({
      session: {
        status: 'complete',
        payment_status: 'paid',
        payment_intent: {
          latest_charge: { amount_refunded: 500 },
        } as unknown as Stripe.PaymentIntent,
      },
    })
    const status = await StripeProvider({ client }).retrieveCheckout('cs_1')
    expect(status.status).toBe('refunded')
    expect(status.amountRefundedInCents).toBe(500)
  })

  it('wraps a retrieve failure rather than leaking the SDK error', async () => {
    const { client } = makeClient({
      retrieveImpl: () => Promise.reject(new Error('No such checkout.session')),
    })
    await expect(StripeProvider({ client }).retrieveCheckout('cs_nope')).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'retrieve_failed',
    })
  })
})

describe('StripeProvider.refund', () => {
  it('resolves a session id to its payment intent before refunding', async () => {
    const { client, refundCreate } = makeClient({
      session: { payment_intent: 'pi_123' as unknown as Stripe.PaymentIntent },
    })
    const result = await StripeProvider({ client }).refund({ reference: 'cs_1' })

    expect((refundCreate.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({
      payment_intent: 'pi_123',
    })
    expect(result).toMatchObject({ id: 're_1', provider: 'stripe', amountInCents: 500 })
  })

  it('passes a payment intent straight through, without a lookup', async () => {
    const { client, retrieve, refundCreate } = makeClient({})
    await StripeProvider({ client }).refund({ reference: 'pi_direct' })
    expect(retrieve).not.toHaveBeenCalled()
    expect((refundCreate.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({
      payment_intent: 'pi_direct',
    })
  })

  it('refuses a session that was never paid, instead of Stripe`s confusing message', async () => {
    // Measured 2026-08-18: passing a cs_ id to /v1/refunds returns
    // "No such payment_intent: cs_…", which sends the reader looking for a
    // payment intent that never existed rather than at the unpaid session.
    const { client } = makeClient({ session: { payment_intent: null, payment_status: 'unpaid' } })
    await expect(StripeProvider({ client }).refund({ reference: 'cs_1' })).rejects.toMatchObject({
      code: 'nothing_to_refund',
    })
  })

  it('sends the idempotency key as a request option, as checkout does', async () => {
    const { client, refundCreate } = makeClient({})
    await StripeProvider({ client }).refund({ reference: 'pi_1', idempotencyKey: 'refund-42' })
    const [params, options] = refundCreate.mock.calls[0] as [
      Record<string, unknown>,
      Stripe.RequestOptions | undefined,
    ]
    expect(options).toEqual({ idempotencyKey: 'refund-42' })
    expect(JSON.stringify(params)).not.toContain('refund-42')
  })

  it('wraps a refund failure as PaymentProviderError', async () => {
    const { client } = makeClient({
      refundImpl: () => Promise.reject(new Error('Charge has already been refunded')),
    })
    await expect(StripeProvider({ client }).refund({ reference: 'pi_1' })).rejects.toMatchObject({
      code: 'refund_failed',
    })
  })
})

describe('StripeProvider.refundPartial', () => {
  it('is advertised through the capability guard', async () => {
    const { client } = makeClient({})
    const { supportsPartialRefund } = await import('../../src/provider.js')
    expect(supportsPartialRefund(StripeProvider({ client }))).toBe(true)
  })

  it('sends the amount', async () => {
    const { client, refundCreate } = makeClient({})
    await StripeProvider({ client }).refundPartial({ reference: 'pi_1', amountInCents: 250 })
    expect((refundCreate.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({
      amount: 250,
    })
  })

  it.each([[0], [-5], [12.5]])('rejects %s before calling Stripe', async (amount) => {
    const { client, refundCreate } = makeClient({})
    await expect(
      StripeProvider({ client }).refundPartial({ reference: 'pi_1', amountInCents: amount }),
    ).rejects.toMatchObject({ code: 'invalid_amount' })
    expect(refundCreate).not.toHaveBeenCalled()
  })
})

describe('StripeProvider.cancelSubscription', () => {
  it('is advertised through the capability guard', async () => {
    const { client } = makeClient({})
    const { supportsSubscriptions } = await import('../../src/provider.js')
    expect(supportsSubscriptions(StripeProvider({ client }))).toBe(true)
  })

  it('cancels by subscription id, without a lookup', async () => {
    const { client, cancel, retrieve } = makeClient({})
    const result = await StripeProvider({ client }).cancelSubscription('sub_1')
    expect(cancel).toHaveBeenCalledWith('sub_1')
    expect(retrieve).not.toHaveBeenCalled()
    expect(result).toMatchObject({ id: 'sub_1', status: 'cancelled', provider: 'stripe' })
  })

  it('resolves a checkout id to the subscription it started', async () => {
    // The caller kept the cs_ id and never saw the sub_ come into being.
    const { client, cancel } = makeClient({
      session: { subscription: 'sub_from_session' as unknown as Stripe.Subscription },
    })
    await StripeProvider({ client }).cancelSubscription('cs_1')
    expect(cancel).toHaveBeenCalledWith('sub_from_session')
  })

  it('says so when the session started no subscription', async () => {
    const { client } = makeClient({ session: { subscription: null } })
    await expect(StripeProvider({ client }).cancelSubscription('cs_1')).rejects.toMatchObject({
      code: 'no_subscription',
    })
  })

  it('does not report a non-canceled terminal state as cancelled', async () => {
    // `incomplete_expired` and `unpaid` are not cancellation. Folding them in
    // would tell the consumer the cancel worked when it never ran.
    const { client } = makeClient({
      cancelImpl: () => Promise.resolve({ id: 'sub_1', status: 'incomplete_expired' }),
    })
    expect((await StripeProvider({ client }).cancelSubscription('sub_1')).status).toBe('unknown')
  })

  it('wraps a cancel failure', async () => {
    const { client } = makeClient({
      cancelImpl: () => Promise.reject(new Error('No such subscription')),
    })
    await expect(StripeProvider({ client }).cancelSubscription('sub_x')).rejects.toMatchObject({
      code: 'cancel_failed',
    })
  })
})
