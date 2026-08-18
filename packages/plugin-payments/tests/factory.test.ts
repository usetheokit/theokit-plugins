/**
 * RED tests for P#6 T1.2 — payments() factory
 *
 * Per plan p6-plugin-payments v1.0 § Phase 1 / T1.2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stripePayments as payments } from '../src/stripe.js'
import { createMemoryStore } from '../src/idempotency-store.js'

const ENV_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
})

describe('payments() factory (P#6 T1.2)', () => {
  it('returns a TheoPlugin shape with name + kind + register + getStripeClient', () => {
    // Given: minimum options (secretKey passed explicitly)
    const plugin = payments({ secretKey: 'sk_test_xxx' })

    // Then: canonical plugin shape
    expect(plugin.name).toBe('@theokit/plugin-payments')
    expect(plugin.kind).toBe('payments')
    expect(typeof plugin.register).toBe('function')
    expect(typeof plugin.getStripeClient).toBe('function')
  })

  it("defaults apiVersion to '2023-10-16'", () => {
    const plugin = payments({ secretKey: 'sk_test_xxx' })
    expect(plugin.options.apiVersion).toBe('2023-10-16')
  })

  it('accepts explicit apiVersion override', () => {
    const plugin = payments({
      secretKey: 'sk_test_xxx',
      apiVersion: '2023-10-16',
    })
    expect(plugin.options.apiVersion).toBe('2023-10-16')
  })

  it('reads STRIPE_SECRET_KEY from env when secretKey omitted', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_from_env'
    const plugin = payments()
    expect(plugin.options.secretKey).toBe('sk_test_from_env')
  })

  it('reads STRIPE_WEBHOOK_SECRET from env when webhookSecret omitted', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_from_env'
    const plugin = payments({ secretKey: 'sk_test_xxx' })
    expect(plugin.options.webhookSecret).toBe('whsec_from_env')
  })

  it('wires a default memory idempotency store when none provided', () => {
    const plugin = payments({ secretKey: 'sk_test_xxx' })
    expect(plugin.options.idempotencyStore).toBeDefined()
    expect(typeof plugin.options.idempotencyStore?.markProcessed).toBe('function')
  })
})

describe('payments() default-idempotency-store guard (T2.4 #202)', () => {
  let savedNodeEnv: string | undefined
  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV
  })
  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = savedNodeEnv
  })

  it('warns loudly when the default (non-multi-replica-safe) memory store is used in production', () => {
    process.env.NODE_ENV = 'production'
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* intentionally empty — silence console output under test */
    })
    payments({ secretKey: 'sk_test_xxx' })
    expect(spy).toHaveBeenCalled()
    const text = spy.mock.calls.map((c) => String(c[0])).join(' ')
    expect(text).toMatch(/idempotency|multi-replica/i)
    spy.mockRestore()
  })

  it('does NOT warn when an explicit idempotencyStore is supplied in production', () => {
    process.env.NODE_ENV = 'production'
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* intentionally empty — silence console output under test */
    })
    payments({ secretKey: 'sk_test_xxx', idempotencyStore: createMemoryStore() })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does NOT warn outside production (default store is fine for dev/test)', () => {
    process.env.NODE_ENV = 'test'
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* intentionally empty — silence console output under test */
    })
    payments({ secretKey: 'sk_test_xxx' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
