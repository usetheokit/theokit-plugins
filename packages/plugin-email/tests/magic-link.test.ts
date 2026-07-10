/**
 * RED tests for P#7 T2.3 + T3.1 — sendMagicLink helper + integration.
 */
import { describe, expect, it } from 'vitest'

import { defaultMagicLinkHtml, defaultMagicLinkText, sendMagicLink } from '../src/magic-link.js'
import type { EmailMessage, EmailProvider } from '../src/types.js'

function makeCaptureProvider(): {
  provider: EmailProvider
  calls: EmailMessage[]
} {
  const calls: EmailMessage[] = []
  return {
    provider: {
      name: 'capture',
      send(message) {
        calls.push(message)
        return Promise.resolve({ id: 'cap_xxx', provider: 'capture' })
      },
    },
    calls,
  }
}

describe('defaultMagicLinkHtml + defaultMagicLinkText (P#7 T2.3)', () => {
  it('default HTML contains the magic link URL', () => {
    const html = defaultMagicLinkHtml({
      magicLinkUrl: 'https://app.test/auth?token=abc',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      appName: 'Acme',
    })
    expect(html).toContain('https://app.test/auth?token=abc')
    expect(html).toContain('Acme')
  })

  it('default HTML escapes user-controlled appName', () => {
    const html = defaultMagicLinkHtml({
      magicLinkUrl: 'https://app.test/x',
      expiresAt: new Date(Date.now() + 60_000),
      appName: '<script>alert(1)</script>',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('default text contains the URL on its own line', () => {
    const text = defaultMagicLinkText({
      magicLinkUrl: 'https://app.test/auth?token=xyz',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      appName: 'Acme',
    })
    expect(text).toContain('https://app.test/auth?token=xyz')
    expect(text).toContain('Acme')
  })

  it('HTML includes expiry minutes hint', () => {
    const html = defaultMagicLinkHtml({
      magicLinkUrl: 'https://app.test/x',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      appName: 'Acme',
    })
    // 15 minutes from now → "15 minutes" in body
    expect(html).toMatch(/15 minutes/)
  })
})

describe('sendMagicLink (P#7 T2.3 + T3.1 integration)', () => {
  it('returns a SendMagicLinkFn-compatible async function', () => {
    const { provider } = makeCaptureProvider()
    const fn = sendMagicLink(provider, {
      from: 'noreply@app.test',
    })
    expect(typeof fn).toBe('function')
  })

  it('invokes provider.send with canonical EmailMessage shape', async () => {
    const { provider, calls } = makeCaptureProvider()
    const fn = sendMagicLink(provider, {
      from: 'Acme <noreply@app.test>',
      appName: 'Acme',
    })

    const expiresAt = new Date(Date.now() + 15 * 60_000)
    await fn({
      to: 'user@example.com',
      magicLinkUrl: 'https://app.test/auth?token=abc',
      expiresAt,
      token: 'abc',
    })

    expect(calls).toHaveLength(1)
    const msg = calls[0]
    expect(msg?.to).toBe('user@example.com')
    expect(msg?.from).toBe('Acme <noreply@app.test>')
    expect(msg?.subject).toBe('Sign in to Acme')
    expect(msg?.html).toContain('https://app.test/auth?token=abc')
    expect(msg?.text).toContain('https://app.test/auth?token=abc')
  })

  it("default appName is 'your app' when omitted", async () => {
    const { provider, calls } = makeCaptureProvider()
    const fn = sendMagicLink(provider, { from: 'noreply@app.test' })

    await fn({
      to: 'user@example.com',
      magicLinkUrl: 'https://app.test/x',
      expiresAt: new Date(Date.now() + 60_000),
      token: 't',
    })

    expect(calls[0]?.subject).toBe('Sign in to your app')
  })

  it('custom subject builder takes precedence', async () => {
    const { provider, calls } = makeCaptureProvider()
    const fn = sendMagicLink(provider, {
      from: 'noreply@app.test',
      appName: 'Acme',
      subject: ({ to, appName }) => `${appName} sign-in for ${to}`,
    })

    await fn({
      to: 'user@example.com',
      magicLinkUrl: 'https://app.test/x',
      expiresAt: new Date(Date.now() + 60_000),
      token: 't',
    })

    expect(calls[0]?.subject).toBe('Acme sign-in for user@example.com')
  })

  it('custom renderHtml takes precedence', async () => {
    const { provider, calls } = makeCaptureProvider()
    const fn = sendMagicLink(provider, {
      from: 'noreply@app.test',
      renderHtml: ({ magicLinkUrl }) => `<a href="${magicLinkUrl}">Click</a>`,
    })

    await fn({
      to: 'user@example.com',
      magicLinkUrl: 'https://app.test/custom',
      expiresAt: new Date(Date.now() + 60_000),
      token: 't',
    })

    expect(calls[0]?.html).toBe('<a href="https://app.test/custom">Click</a>')
  })

  it('default idempotencyKey is derived from token', async () => {
    const { provider, calls } = makeCaptureProvider()
    const fn = sendMagicLink(provider, { from: 'noreply@app.test' })

    await fn({
      to: 'user@example.com',
      magicLinkUrl: 'https://app.test/x',
      expiresAt: new Date(Date.now() + 60_000),
      token: 'tok_abc123',
    })

    expect(calls[0]?.idempotencyKey).toBe('magic_link:tok_abc123')
  })

  it('idempotencyKey can be disabled with null', async () => {
    const { provider, calls } = makeCaptureProvider()
    const fn = sendMagicLink(provider, {
      from: 'noreply@app.test',
      idempotencyKey: null,
    })

    await fn({
      to: 'user@example.com',
      magicLinkUrl: 'https://app.test/x',
      expiresAt: new Date(Date.now() + 60_000),
      token: 'tok_xyz',
    })

    expect(calls[0]?.idempotencyKey).toBeUndefined()
  })

  it('custom idempotencyKey builder takes precedence', async () => {
    const { provider, calls } = makeCaptureProvider()
    const fn = sendMagicLink(provider, {
      from: 'noreply@app.test',
      idempotencyKey: ({ token }) => `custom:${token}`,
    })

    await fn({
      to: 'user@example.com',
      magicLinkUrl: 'https://app.test/x',
      expiresAt: new Date(Date.now() + 60_000),
      token: 'tok_xyz',
    })

    expect(calls[0]?.idempotencyKey).toBe('custom:tok_xyz')
  })

  it('propagates provider errors (errors NOT swallowed)', async () => {
    const provider: EmailProvider = {
      name: 'failing',
      send() {
        return Promise.reject(new Error('smtp down'))
      },
    }
    const fn = sendMagicLink(provider, { from: 'noreply@app.test' })

    await expect(
      fn({
        to: 'user@example.com',
        magicLinkUrl: 'https://app.test/x',
        expiresAt: new Date(Date.now() + 60_000),
        token: 't',
      }),
    ).rejects.toThrow('smtp down')
  })
})
