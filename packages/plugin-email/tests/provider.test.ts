/**
 * RED tests for P#7 T1.2 + T1.3 — EmailProvider interface + ResendProvider factory.
 */
import { describe, expect, it, vi } from 'vitest'

import { defineEmailProvider } from '../src/provider.js'
import { ResendProvider, type ResendClientLike } from '../src/resend-provider.js'
import type { EmailMessage } from '../src/types.js'
import { EmailSendError } from '../src/types.js'

function makeMockResendClient(sendImpl: ResendClientLike['emails']['send']): ResendClientLike {
  return { emails: { send: sendImpl } }
}

describe('defineEmailProvider (P#7 T1.2)', () => {
  it('passes through the implementation unchanged', () => {
    const impl = {
      name: 'stub',
      send(_message: EmailMessage) {
        return Promise.resolve({ id: 'stub_xxx', provider: 'stub' })
      },
    }
    const provider = defineEmailProvider(impl)
    expect(provider).toBe(impl)
    expect(provider.name).toBe('stub')
  })

  // Negative cases (fail-fast at wiring time) — mirror defineRealtimeProvider.
  it('throws a typed error when the implementation is null', () => {
    expect(() => defineEmailProvider(null as never)).toThrow(TypeError)
    expect(() => defineEmailProvider(null as never)).toThrow(
      'defineEmailProvider: provider implementation is required',
    )
  })

  it('throws a typed error when the implementation is not an object', () => {
    expect(() => defineEmailProvider(undefined as never)).toThrow(
      'defineEmailProvider: provider implementation is required',
    )
  })

  it('throws a typed error when name is missing or empty', () => {
    expect(() => defineEmailProvider({} as never)).toThrow(
      'defineEmailProvider: impl.name must be a non-empty string',
    )
    expect(() => defineEmailProvider({ name: '' } as never)).toThrow(
      'defineEmailProvider: impl.name must be a non-empty string',
    )
  })

  it('throws a typed error when send is not a function', () => {
    expect(() => defineEmailProvider({ name: 'x' } as never)).toThrow(
      'defineEmailProvider: impl.send must be a function',
    )
  })

  it('returns a provider that can be invoked', async () => {
    const calls: EmailMessage[] = []
    const provider = defineEmailProvider({
      name: 'capture',
      send(message) {
        calls.push(message)
        return Promise.resolve({ id: 'cap_xxx', provider: 'capture' })
      },
    })
    const result = await provider.send({
      to: 'x@y.com',
      from: 'y@z.com',
      subject: 'hi',
      html: '<p>hi</p>',
    })
    expect(result.id).toBe('cap_xxx')
    expect(calls).toHaveLength(1)
  })
})

describe('ResendProvider factory (P#7 T1.3)', () => {
  it('throws when neither apiKey nor client provided', () => {
    expect(() => ResendProvider({})).toThrow(/apiKey.*client/i)
  })

  it("returns a provider with name='resend'", () => {
    const provider = ResendProvider({
      client: makeMockResendClient(() =>
        Promise.resolve({ data: { id: 'b1f0e0c2-0000-4000-8000-000000000003' } }),
      ),
    })
    expect(provider.name).toBe('resend')
  })

  it('send() invokes resend.emails.send with mapped payload', async () => {
    const send = vi.fn(() =>
      Promise.resolve({ data: { id: 'b1f0e0c2-0000-4000-8000-000000000003' } }),
    )
    const provider = ResendProvider({ client: makeMockResendClient(send) })

    await provider.send({
      to: 'user@example.com',
      from: 'noreply@app.test',
      subject: 'Welcome',
      html: '<p>Hello</p>',
      text: 'Hello',
      cc: ['cc@example.com'],
      replyTo: 'reply@app.test',
    })

    expect(send).toHaveBeenCalledOnce()
    const callList = send.mock.calls as unknown as Record<string, unknown>[][]
    const payload = callList[0]?.[0] ?? {}
    expect(payload.to).toBe('user@example.com')
    expect(payload.from).toBe('noreply@app.test')
    expect(payload.subject).toBe('Welcome')
    expect(payload.html).toBe('<p>Hello</p>')
    expect(payload.text).toBe('Hello')
    expect(payload.cc).toEqual(['cc@example.com'])
    expect(payload.replyTo).toBe('reply@app.test')
  })

  it('idempotencyKey goes in the request options, not in the message headers', async () => {
    // This assertion used to read `payload.headers['Idempotency-Key']` under the
    // name "maps to Idempotency-Key HTTP header". Both cannot be true:
    // `payload.headers` are MIME headers of the message, and the dedup header is
    // an HTTP header of the request, which the SDK exposes only as the second
    // argument (`CreateEmailRequestOptions`). The old test passed while Resend
    // never deduplicated a thing; the live e2e suite sent one key twice, got two
    // different ids, and that is how it surfaced.
    const send = vi.fn(() =>
      Promise.resolve({ data: { id: 'b1f0e0c2-0000-4000-8000-000000000001' } }),
    )
    const provider = ResendProvider({ client: makeMockResendClient(send) })

    await provider.send({
      to: 'x@y.com',
      from: 'y@z.com',
      subject: 'test',
      html: '<p>t</p>',
      idempotencyKey: 'msg_abc123',
    })

    const call = send.mock.calls[0] as unknown as [
      { headers?: Record<string, string> },
      { idempotencyKey?: string } | undefined,
    ]
    expect(call[1]?.idempotencyKey).toBe('msg_abc123')
    // And it must NOT leak into the message as a decorative MIME header.
    expect(call[0]?.headers?.['Idempotency-Key']).toBeUndefined()
  })

  it('keeps custom MIME headers separate from the idempotency key', async () => {
    const send = vi.fn(() =>
      Promise.resolve({ data: { id: 'b1f0e0c2-0000-4000-8000-000000000002' } }),
    )
    const provider = ResendProvider({ client: makeMockResendClient(send) })

    await provider.send({
      to: 'x@y.com',
      from: 'y@z.com',
      subject: 'test',
      html: '<p>t</p>',
      idempotencyKey: 'key_1',
      headers: { 'X-Custom': 'value' },
    })

    const call = send.mock.calls[0] as unknown as [
      { headers?: Record<string, string> },
      { idempotencyKey?: string } | undefined,
    ]
    // The consumer's own headers still travel with the message, untouched.
    expect(call[0]?.headers).toEqual({ 'X-Custom': 'value' })
    expect(call[1]?.idempotencyKey).toBe('key_1')
  })

  it('throws EmailSendError when Resend returns error response', async () => {
    const provider = ResendProvider({
      client: makeMockResendClient(() =>
        Promise.resolve({ error: { message: 'Invalid recipient' } }),
      ),
    })

    await expect(
      provider.send({
        to: 'bad@',
        from: 'y@z.com',
        subject: 't',
        html: '<p>t</p>',
      }),
    ).rejects.toThrow(EmailSendError)
  })

  it('returns SendResult shape on success', async () => {
    const provider = ResendProvider({
      client: makeMockResendClient(() =>
        Promise.resolve({ data: { id: 'b1f0e0c2-0000-4000-8000-000000000042' } }),
      ),
    })
    const result = await provider.send({
      to: 'x@y.com',
      from: 'y@z.com',
      subject: 't',
      html: '<p>t</p>',
    })
    expect(result.id).toBe('b1f0e0c2-0000-4000-8000-000000000042')
    expect(result.provider).toBe('resend')
  })

  it('throws EmailSendError when client.emails.send throws', async () => {
    const provider = ResendProvider({
      client: makeMockResendClient(() => Promise.reject(new Error('network down'))),
    })
    await expect(
      provider.send({
        to: 'x@y.com',
        from: 'y@z.com',
        subject: 't',
        html: '<p>t</p>',
      }),
    ).rejects.toThrow(EmailSendError)
  })
})
