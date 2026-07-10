import { describe, expect, it } from 'vitest'
import {
  RealtimeAuthorizationError,
  RealtimeBroadcastError,
  RealtimeError,
  RealtimePresenceError,
  RealtimeRoomNotFoundError,
} from '../src/types.js'

describe('RealtimeError hierarchy', () => {
  it('RealtimeError carries optional code', () => {
    const e = new RealtimeError('boom', { code: 'test_code' })
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('RealtimeError')
    expect(e.code).toBe('test_code')
    expect(e.message).toBe('boom')
  })

  it('RealtimeError defaults code undefined', () => {
    const e = new RealtimeError('plain')
    expect(e.code).toBeUndefined()
  })

  it('RealtimePresenceError extends RealtimeError + exposes issues', () => {
    const e = new RealtimePresenceError('bad', { issues: { x: ['required'] } })
    expect(e).toBeInstanceOf(RealtimeError)
    expect(e.name).toBe('RealtimePresenceError')
    expect(e.code).toBe('presence_invalid')
    expect(e.issues).toEqual({ x: ['required'] })
  })

  it('RealtimeBroadcastError extends RealtimeError + exposes issues', () => {
    const e = new RealtimeBroadcastError('bad', { issues: { kind: ['enum'] } })
    expect(e).toBeInstanceOf(RealtimeError)
    expect(e.name).toBe('RealtimeBroadcastError')
    expect(e.code).toBe('broadcast_invalid')
  })

  it('RealtimeRoomNotFoundError sets code + roomId in message', () => {
    const e = new RealtimeRoomNotFoundError('chat')
    expect(e.code).toBe('room_not_found')
    expect(e.message).toContain('chat')
  })

  it('RealtimeAuthorizationError sets code + roomId', () => {
    const e = new RealtimeAuthorizationError('private')
    expect(e.code).toBe('authorization_rejected')
    expect(e.roomId).toBe('private')
  })
})
