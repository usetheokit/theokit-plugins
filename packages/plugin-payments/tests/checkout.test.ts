/**
 * RED tests for P#6 T2.4 — Checkout session helper + currency helpers
 */
import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

import { CheckoutSessionMisconfigError, createCheckoutSession } from '../src/checkout.js'
import { formatAmountForDisplay, formatAmountForStripe } from '../src/currency.js'

function makeMockClient(sessionFactory: () => Partial<Stripe.Checkout.Session>): Stripe {
  return {
    checkout: {
      sessions: {
        create: vi.fn((..._args: unknown[]) => Promise.resolve(sessionFactory())),
      },
    },
  } as unknown as Stripe
}

describe('createCheckoutSession (P#6 T2.4)', () => {
  it('returns {url, sessionId} when Stripe session has a URL', async () => {
    const client = makeMockClient(() => ({
      id: 'cs_test_xxx',
      url: 'https://checkout.stripe.com/c/pay/cs_test_xxx',
    }))

    const result = await createCheckoutSession(client, {
      mode: 'payment',
      success_url: 'https://app.test/success',
      cancel_url: 'https://app.test/cancel',
      line_items: [],
    })

    expect(result.sessionId).toBe('cs_test_xxx')
    // Narrowed, because the envelope is discriminated now: an embedded session has no url at all.
    expect(result.uiMode).toBe('hosted')
    expect(result.uiMode === 'hosted' ? result.url : null).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_xxx',
    )
  })

  it('throws CheckoutSessionMisconfigError when session lacks URL', async () => {
    const client = makeMockClient(() => ({ id: 'cs_test_no_url', url: null }))

    await expect(
      createCheckoutSession(client, {
        mode: 'payment',
        line_items: [],
      }),
    ).rejects.toThrow(CheckoutSessionMisconfigError)
  })

  it('passes params through verbatim to stripe.checkout.sessions.create', async () => {
    const createSpy = vi.fn(() =>
      Promise.resolve({
        id: 'cs_test_xxx',
        url: 'https://checkout.stripe.com/c/pay/cs_test_xxx',
      }),
    )
    const client = {
      checkout: { sessions: { create: createSpy } },
    } as unknown as Stripe

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      success_url: 'https://app.test/success',
      cancel_url: 'https://app.test/cancel',
      line_items: [{ price: 'price_xxx', quantity: 1 }],
      customer_email: 'user@test.com',
      metadata: { userId: 'u_123' },
    }

    await createCheckoutSession(client, params)
    expect(createSpy).toHaveBeenCalledWith(params)
  })
})

describe('formatAmountForStripe (P#6 T2.4 currency helper)', () => {
  it('converts decimal currency amount to integer cents', () => {
    // USD 1.50 → 150 cents
    expect(formatAmountForStripe(1.5, 'USD')).toBe(150)
  })

  it('returns integer unit unchanged for zero-decimal currencies (JPY)', () => {
    // JPY has no decimal places; pass through as-is
    expect(formatAmountForStripe(1500, 'JPY')).toBe(1500)
  })

  it('rounds fractional cents via Math.round (JS banker behavior)', () => {
    // USD 1.006 → 100.6 → 101 cents (clearly rounded up, unambiguous)
    expect(formatAmountForStripe(1.006, 'USD')).toBe(101)
    // USD 1.004 → 100.4 → 100 cents (clearly rounded down)
    expect(formatAmountForStripe(1.004, 'USD')).toBe(100)
  })
})

describe('formatAmountForStripe — currency-correct minor units (T2.1 #199/#200)', () => {
  // #200: ICU formats these with 0 decimals, but Stripe does NOT list them as
  // zero-decimal → they are charged in 2-decimal minor units (x100). The old
  // Intl-introspection returned the amount unchanged → 100x undercharge.
  it('charges ISK in x100 minor units (not zero-decimal per Stripe)', () => {
    expect(formatAmountForStripe(10, 'ISK')).toBe(1000)
  })
  it('charges HUF in x100 minor units (not zero-decimal per Stripe)', () => {
    expect(formatAmountForStripe(5, 'HUF')).toBe(500)
  })
  it('charges UGX in x100 minor units — UGX is a Stripe special case, NOT zero-decimal', () => {
    expect(formatAmountForStripe(10, 'UGX')).toBe(1000)
  })

  // #200: 3-decimal currencies must be x1000, in multiples of 10 (Stripe rule).
  it('charges KWD (3-decimal) in x1000 minor units', () => {
    expect(formatAmountForStripe(10, 'KWD')).toBe(10000)
  })
  it('rounds 3-decimal minor units to a multiple of 10 (Stripe requirement)', () => {
    expect(formatAmountForStripe(15.778, 'KWD')).toBe(15780)
  })

  // zero-decimal passthrough (the authoritative Stripe set, code-keyed)
  it('passes zero-decimal currencies through unchanged (code-keyed, not Intl)', () => {
    expect(formatAmountForStripe(1500, 'JPY')).toBe(1500)
    expect(formatAmountForStripe(100, 'KRW')).toBe(100)
    expect(formatAmountForStripe(5, 'XOF')).toBe(5)
    expect(formatAmountForStripe(0, 'USD')).toBe(0)
  })
  it('rejects a non-integer amount for a zero-decimal currency', () => {
    expect(() => formatAmountForStripe(99.5, 'JPY')).toThrow()
  })

  // #199: integer-exact scaling (no binary-float). Round-half-up at the next digit.
  it('scales decimal amounts integer-exactly (no float drift)', () => {
    expect(formatAmountForStripe(1.5, 'USD')).toBe(150)
    expect(formatAmountForStripe(99.99, 'USD')).toBe(9999)
    expect(formatAmountForStripe(1.006, 'USD')).toBe(101)
    expect(formatAmountForStripe(1.004, 'USD')).toBe(100)
    // 1.005*100 = 100.4999… in binary float → old Math.round gives 100 (wrong).
    // Decimal round-half-up gives 101.
    expect(formatAmountForStripe(1.005, 'USD')).toBe(101)
  })

  // EC-5: reject amounts whose minor units would exceed MAX_SAFE_INTEGER.
  it('rejects an amount that overflows MAX_SAFE_INTEGER in minor units', () => {
    expect(() => formatAmountForStripe(9.01e16, 'USD')).toThrow()
  })

  // negative amounts are not valid charge amounts → fail loud.
  it('rejects a negative amount', () => {
    expect(() => formatAmountForStripe(-1, 'USD')).toThrow()
  })
})

describe('formatAmountForDisplay (P#6 T2.4 currency helper)', () => {
  it('formats USD with $ symbol', () => {
    // en-US locale + USD currency → "$1.50"
    expect(formatAmountForDisplay(1.5, 'USD')).toContain('$')
  })

  it('formats JPY without decimal point', () => {
    const formatted = formatAmountForDisplay(1500, 'JPY')
    expect(formatted).not.toContain('.')
  })
})

describe('createCheckoutSession and the embedded mode', () => {
  /** A client whose `create` echoes what a real embedded session looks like. */
  function embeddedClient(session: Record<string, unknown>) {
    return {
      checkout: { sessions: { create: () => Promise.resolve(session) } },
    } as unknown as Parameters<typeof createCheckoutSession>[0]
  }

  it('returns the client secret instead of throwing on the null url', async () => {
    // This helper passes `params` VERBATIM, so a consumer could always ask Stripe for an embedded
    // session — and then hit the same null-url throw the provider used to have. Leaving it there
    // while the provider serves both modes would be a second copy of the same wall.
    const result = await createCheckoutSession(
      embeddedClient({
        id: 'cs_1',
        url: null,
        client_secret: 'cs_1_secret_abc',
        ui_mode: 'embedded',
      }),
      { ui_mode: 'embedded', mode: 'payment', line_items: [], return_url: 'https://x/return' },
    )

    expect(result.uiMode).toBe('embedded')
    expect(result.uiMode === 'embedded' ? result.clientSecret : null).toBe('cs_1_secret_abc')
  })

  it('still refuses a hosted session with no url', async () => {
    // The existing guarantee, unchanged: a hosted session without a url is a misconfiguration.
    await expect(
      createCheckoutSession(embeddedClient({ id: 'cs_1', url: null }), {
        mode: 'payment',
        line_items: [],
      }),
    ).rejects.toBeInstanceOf(CheckoutSessionMisconfigError)
  })

  it('fails by name when an embedded session has no client secret', async () => {
    await expect(
      createCheckoutSession(
        embeddedClient({ id: 'cs_1', url: null, client_secret: null, ui_mode: 'embedded' }),
        { ui_mode: 'embedded', mode: 'payment', line_items: [], return_url: 'https://x/return' },
      ),
    ).rejects.toThrow(/client secret|client_secret/i)
  })
})
