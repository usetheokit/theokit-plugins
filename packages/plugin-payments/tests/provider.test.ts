/**
 * The provider contract itself: registration validation and capability detection.
 *
 * `definePaymentProvider` is a boot-time gate, so what matters is that a
 * malformed provider is rejected THERE rather than during someone's checkout.
 */
import { describe, expect, it } from 'vitest'

import { definePaymentProvider, supportsPartialRefund, supportsPix } from '../src/provider.js'
import type {
  PartialRefundCapableProvider,
  PaymentProvider,
  PixCapableProvider,
} from '../src/provider-types.js'

function minimalProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    name: 'fake',
    createCheckout: () =>
      Promise.resolve({
        id: 'id',
        uiMode: 'hosted' as const,
        url: 'https://pay.example/1',
        provider: 'fake',
        raw: {},
      }),
    verifyWebhook: () =>
      Promise.resolve({
        type: 'unknown' as const,
        id: 'evt',
        providerEventType: 'whatever',
        provider: 'fake',
        raw: {},
      }),
    retrieveCheckout: () =>
      Promise.resolve({ id: 'id', status: 'pending' as const, provider: 'fake', raw: {} }),
    refund: () => Promise.resolve({ id: 'ref', provider: 'fake', raw: {} }),
    ...overrides,
  }
}

describe('definePaymentProvider', () => {
  it('returns the same object rather than a wrapper, so stack traces still point at the implementation', () => {
    const impl = minimalProvider()
    expect(definePaymentProvider(impl)).toBe(impl)
  })

  it('rejects a provider with no name', () => {
    expect(() => definePaymentProvider(minimalProvider({ name: '' }))).toThrow(
      /impl.name must be a non-empty string/,
    )
  })

  it('rejects a provider that cannot create a checkout', () => {
    const broken = { ...minimalProvider(), createCheckout: undefined } as unknown as PaymentProvider
    expect(() => definePaymentProvider(broken)).toThrow(/impl.createCheckout must be a function/)
  })

  it('rejects a provider that cannot verify a webhook', () => {
    const broken = { ...minimalProvider(), verifyWebhook: 'nope' } as unknown as PaymentProvider
    expect(() => definePaymentProvider(broken)).toThrow(/impl.verifyWebhook must be a function/)
  })

  it('rejects a provider that cannot answer where a charge stands', () => {
    // retrieveCheckout is not optional: without it, reconciling a dropped
    // webhook means reaching around the contract to the gateway SDK.
    const broken = {
      ...minimalProvider(),
      retrieveCheckout: undefined,
    } as unknown as PaymentProvider
    expect(() => definePaymentProvider(broken)).toThrow(/impl.retrieveCheckout must be a function/)
  })

  it('rejects a provider that cannot refund', () => {
    const broken = { ...minimalProvider(), refund: undefined } as unknown as PaymentProvider
    expect(() => definePaymentProvider(broken)).toThrow(/impl.refund must be a function/)
  })

  it('rejects a non-function refundPartial, for the same reason as createPixCharge', () => {
    const broken = { ...minimalProvider(), refundPartial: 1 } as unknown as PaymentProvider
    expect(() => definePaymentProvider(broken)).toThrow(
      /impl.refundPartial must be a function when present/,
    )
  })

  it('rejects a non-function createPixCharge, because supportsPix would then report a lie', () => {
    const halfPix = { ...minimalProvider(), createPixCharge: true } as unknown as PaymentProvider
    expect(() => definePaymentProvider(halfPix)).toThrow(
      /impl.createPixCharge must be a function when present/,
    )
  })

  it('rejects a null implementation', () => {
    expect(() => definePaymentProvider(null as unknown as PaymentProvider)).toThrow(
      /provider implementation is required/,
    )
  })
})

describe('supportsPix', () => {
  it('is false for a provider without the capability', () => {
    expect(supportsPix(minimalProvider())).toBe(false)
  })

  it('is true, and narrows the type, for a provider that has it', () => {
    const pixCapable: PixCapableProvider = {
      ...minimalProvider({ name: 'pixy' }),
      createPixCharge: () =>
        Promise.resolve({
          id: 'pix_1',
          brCode: '000201',
          brCodeBase64: 'data:image/png;base64,AA',
          provider: 'pixy',
          raw: {},
        }),
    }
    const asBase: PaymentProvider = pixCapable
    expect(supportsPix(asBase)).toBe(true)
    // The guard is what makes this line compile — without it, `asBase` has no
    // createPixCharge and tsc rejects the call.
    if (supportsPix(asBase)) {
      expect(typeof asBase.createPixCharge).toBe('function')
    }
  })
})

describe('supportsPartialRefund', () => {
  it('is false for a provider that only refunds in full', () => {
    expect(supportsPartialRefund(minimalProvider())).toBe(false)
  })

  it('is true, and narrows the type, for a provider that can', () => {
    const capable: PartialRefundCapableProvider = {
      ...minimalProvider({ name: 'parts' }),
      refundPartial: () => Promise.resolve({ id: 'ref', provider: 'parts', raw: {} }),
    }
    const asBase: PaymentProvider = capable
    expect(supportsPartialRefund(asBase)).toBe(true)
    if (supportsPartialRefund(asBase)) {
      expect(typeof asBase.refundPartial).toBe('function')
    }
  })
})
