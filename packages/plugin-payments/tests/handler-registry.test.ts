import { describe, expect, it } from 'vitest'

import { HandlerRegistry } from '../src/handler-registry.js'

describe('HandlerRegistry', () => {
  it('runs every handler in LIFO order and aggregates the one failure', async () => {
    const registry = new HandlerRegistry<{ type: string }>()
    const order: string[] = []
    const boom = new Error('middle failed')
    registry.register({ eventType: 'a', handle: () => Promise.resolve(void order.push('first')) })
    registry.register({
      eventType: 'a',
      handle: () => {
        order.push('middle')
        return Promise.reject(boom)
      },
    })
    registry.register({ eventType: 'a', handle: () => Promise.resolve(void order.push('last')) })

    const err = await registry.dispatch({ type: 'a' }).catch((e: unknown) => e)
    expect(order).toEqual(['last', 'middle', 'first'])
    expect(err).toBeInstanceOf(AggregateError)
    expect((err as AggregateError).errors).toEqual([boom])
    expect(registry.hasHandlersFor('a')).toBe(true)
    expect(registry.hasHandlersFor('b')).toBe(false)
  })
})
