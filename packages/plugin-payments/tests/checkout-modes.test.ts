/**
 * The contract has to say WHICH of two incompatible URL sets applies.
 *
 * Measured live against real Stripe: `success_url` is not supported with `ui_mode: embedded` — the
 * API refuses the combination outright. An embedded session takes `return_url` INSTEAD. A type that
 * lets a caller send all three defers a known-invalid request to the gateway, when it could refuse
 * to compile.
 *
 * The result is discriminated for a different reason. `CheckoutResult.url` is documented as "where
 * to send the customer" and is `readonly url: string` — a promise both providers keep today, read
 * unguarded by this repository's own live suite. An embedded session has no URL and carries a
 * `client_secret`. Making `url` optional would move a compile-time guarantee into a runtime check
 * for the majority who will never use embedded; discriminating keeps it.
 */
import { describe, expect, it } from 'vitest'

import type { CheckoutInput, CheckoutResult } from '../src/provider-types.js'

describe('the checkout input', () => {
  it('still accepts a hosted call with no mode field at all', () => {
    // The additive check: every existing caller keeps compiling and keeps meaning what it meant.
    const input: CheckoutInput = {
      items: [{ ref: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/ok',
      cancelUrl: 'https://example.com/cancel',
    }

    expect(input.successUrl).toBe('https://example.com/ok')
  })

  it('accepts an embedded call carrying a returnUrl', () => {
    const input: CheckoutInput = {
      items: [{ ref: 'price_123', quantity: 1 }],
      uiMode: 'embedded',
      returnUrl: 'https://example.com/return?s={CHECKOUT_SESSION_ID}',
    }

    expect(input.uiMode).toBe('embedded')
  })

  it('refuses successUrl on an embedded call, at compile time', () => {
    // @ts-expect-error — Stripe refuses this combination; the type refuses it first.
    const input: CheckoutInput = {
      items: [{ ref: 'price_123', quantity: 1 }],
      uiMode: 'embedded',
      returnUrl: 'https://example.com/return',
      successUrl: 'https://example.com/ok',
    }

    // The assertion that matters is the `@ts-expect-error` above: if the type stops forbidding the
    // combination, THAT line fails to compile because the error it expects never happens.
    expect(input.items).toHaveLength(1)
  })

  it('refuses returnUrl on a hosted call, at compile time', () => {
    // @ts-expect-error — the exclusion runs both ways, or the type only half-describes the rule.
    const input: CheckoutInput = {
      items: [{ ref: 'price_123', quantity: 1 }],
      uiMode: 'hosted',
      successUrl: 'https://example.com/ok',
      returnUrl: 'https://example.com/return',
    }

    expect(input.items).toHaveLength(1)
  })
})

describe('the checkout result', () => {
  it('gives a url on the hosted branch and a clientSecret on the embedded one', () => {
    const hosted: CheckoutResult = {
      id: 'cs_test_1',
      uiMode: 'hosted',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      provider: 'stripe',
      raw: {},
    }
    const embedded: CheckoutResult = {
      id: 'cs_test_2',
      uiMode: 'embedded',
      clientSecret: 'cs_test_2_secret_abc',
      provider: 'stripe',
      raw: {},
    }

    // Narrowing is what gives each branch its own field. Without the discriminator this reads
    // `string | undefined` on both, which is the runtime check the discrimination avoids.
    expect(hosted.uiMode === 'hosted' ? hosted.url : null).toMatch(/^https:/)
    expect(embedded.uiMode === 'embedded' ? embedded.clientSecret : null).toMatch(/_secret_/)
  })

  it('keeps url REQUIRED on the hosted branch', () => {
    // @ts-expect-error — a hosted result without a url is the shape this contract promises never
    // to produce, and the promise is what an unguarded consumer relies on.
    const hosted: CheckoutResult = { id: 'cs_test_3', uiMode: 'hosted', provider: 'stripe', raw: {} }

    expect(hosted.id).toBe('cs_test_3')
  })
})
