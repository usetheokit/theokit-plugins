import { describe, expect, it } from 'vitest'
import { defineRealtimeProvider } from '../src/provider.js'
import type { RealtimeProvider } from '../src/types.js'

const stubProvider: RealtimeProvider = {
  name: 'stub',
  joinRoom() {
    return Promise.resolve()
  },
  leaveRoom() {
    return Promise.resolve()
  },
  broadcast() {
    return Promise.resolve()
  },
  updatePresence() {
    return Promise.resolve()
  },
  getPresence() {
    return Promise.resolve({})
  },
  subscribeRoom() {
    return () => {
      /* intentionally empty — stub unsubscribe has nothing to release */
    }
  },
}

describe('defineRealtimeProvider', () => {
  it('returns the provider identity unchanged', () => {
    const result = defineRealtimeProvider(stubProvider)
    expect(result).toBe(stubProvider)
    expect(result.name).toBe('stub')
  })

  it('throws on null/undefined impl', () => {
    expect(() =>
      // @ts-expect-error runtime guard
      defineRealtimeProvider(null),
    ).toThrow(TypeError)
  })

  it('throws when name missing', () => {
    expect(() => defineRealtimeProvider({ ...stubProvider, name: '' })).toThrow(TypeError)
  })

  it('throws when required method missing', () => {
    expect(() =>
      defineRealtimeProvider({
        ...stubProvider,
        // @ts-expect-error runtime guard
        joinRoom: undefined,
      }),
    ).toThrow(TypeError)
  })
})
