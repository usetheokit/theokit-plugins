/**
 * Tests for ResendProvider error-context preservation and success path.
 *
 * Complements provider.test.ts with focused assertions on the `{ cause }`
 * chain — ensuring callers can inspect the original error via `.cause`.
 */
import { describe, expect, it } from 'vitest'

import { ResendProvider, type ResendClientLike } from '../src/resend-provider.js'
import { EmailSendError } from '../src/types.js'

function makeMockClient(sendImpl: ResendClientLike['emails']['send']): ResendClientLike {
  return { emails: { send: sendImpl } }
}

const MINIMAL_MESSAGE = {
  to: 'user@example.com',
  from: 'noreply@app.test',
  subject: 'Test',
  html: '<p>hello</p>',
} as const

describe('ResendProvider error context', () => {
  it('preserves cause when client.emails.send throws', async () => {
    const original = new Error('network timeout')
    const provider = ResendProvider({
      client: makeMockClient(() => Promise.reject(original)),
    })

    let caught: unknown
    try {
      await provider.send(MINIMAL_MESSAGE)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(EmailSendError)
    const sendError = caught as EmailSendError
    expect(sendError.cause).toBe(original)
    expect(sendError.provider).toBe('resend')
  })

  it('preserves cause when Resend returns an error response', async () => {
    const errorPayload = { message: 'Invalid API key', name: 'validation_error' }
    const provider = ResendProvider({
      client: makeMockClient(() => Promise.resolve({ error: errorPayload, data: null })),
    })

    let caught: unknown
    try {
      await provider.send(MINIMAL_MESSAGE)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(EmailSendError)
    const sendError = caught as EmailSendError
    expect(sendError.cause).toBe(errorPayload)
    expect(sendError.message).toContain('Invalid API key')
    expect(sendError.provider).toBe('resend')
  })

  it('returns SendResult on success', async () => {
    const provider = ResendProvider({
      client: makeMockClient(() => Promise.resolve({ data: { id: 're_success_123' } })),
    })

    const result = await provider.send(MINIMAL_MESSAGE)

    expect(result.id).toBe('re_success_123')
    expect(result.provider).toBe('resend')
    expect(result.raw).toBeDefined()
  })
})
