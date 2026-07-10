import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRoom } from '../src/define-room.js'

describe('defineRoom', () => {
  it('returns descriptor with id + schemas', () => {
    const presence = z.object({ cursor: z.tuple([z.number(), z.number()]).optional() })
    const broadcast = z.object({ kind: z.literal('ping') })
    const room = defineRoom({ id: 'canvas', presence, broadcast })
    expect(room.id).toBe('canvas')
    expect(room.presence).toBe(presence)
    expect(room.broadcast).toBe(broadcast)
    expect(room.storage).toBeUndefined()
    expect(room.authorize).toBeUndefined()
  })

  it("preserves storage: 'yjs'", () => {
    const room = defineRoom({
      id: 'doc',
      presence: z.object({}),
      broadcast: z.object({}),
      storage: 'yjs',
    })
    expect(room.storage).toBe('yjs')
  })

  it('preserves authorize hook', () => {
    const authorize = () => true
    const room = defineRoom({
      id: 'private',
      presence: z.object({}),
      broadcast: z.object({}),
      authorize,
    })
    expect(room.authorize).toBe(authorize)
  })

  it('throws when id is empty', () => {
    expect(() => defineRoom({ id: '', presence: z.object({}), broadcast: z.object({}) })).toThrow(
      TypeError,
    )
  })

  it('throws when presence schema missing', () => {
    expect(() =>
      defineRoom({
        id: 'x',
        // @ts-expect-error runtime guard
        presence: undefined,
        broadcast: z.object({}),
      }),
    ).toThrow(TypeError)
  })

  it('throws when broadcast schema missing', () => {
    expect(() =>
      defineRoom({
        id: 'x',
        presence: z.object({}),
        // @ts-expect-error runtime guard
        broadcast: undefined,
      }),
    ).toThrow(TypeError)
  })

  it('throws on unknown storage value', () => {
    expect(() =>
      defineRoom({
        id: 'x',
        presence: z.object({}),
        broadcast: z.object({}),
        // @ts-expect-error runtime guard
        storage: 'redis',
      }),
    ).toThrow(TypeError)
  })
})
