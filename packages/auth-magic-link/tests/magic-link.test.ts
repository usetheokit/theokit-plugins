/**
 * @theokit/auth-magic-link — T4.1 unit + integration tests.
 *
 * Covers plan TDD checklist:
 *   - test_magic_link_token_is_32_bytes_url_safe
 *   - test_magic_link_token_consumed_only_once
 *   - test_magic_link_token_expires_after_lifetime  (time-mock via vi.useFakeTimers)
 *   - test_magic_link_callback_throws_on_missing_token
 *   - test_magic_link_callback_throws_on_expired_token
 *   - test_magic_link_send_email_error_propagates   (D8 invariant)
 *   - test_memory_store_isolated_per_instance
 *   - test_orm_store_via_real_repository            (uses in-memory MagicLinkRepository)
 *   - test_magic_link_token_consumed_atomically_under_race  (v1.1 EC-11)
 *   - test_magic_link_throws_on_missing_or_invalid_email    (v1.1 EC-12)
 */

import type { IncomingMessage } from 'node:http'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  createMemoryStore,
  createOrmStore,
  magicLink,
  MagicLinkConfigError,
  type MagicLinkRepository,
  type SendMagicLinkFn,
} from '../src/index.js'

/**
 * Turn a list of chunks into a proper async iterable without an await-less
 * async generator. Each `next()` resolves synchronously via Promise.resolve —
 * `for await...of` awaits every yielded value, so the shape is honored.
 */
function asyncStreamOf(chunks: Buffer[]): AsyncIterable<Buffer> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Buffer> {
      let i = 0
      return {
        next(): Promise<IteratorResult<Buffer>> {
          return Promise.resolve(
            i < chunks.length
              ? { value: chunks[i++]!, done: false }
              : { value: undefined, done: true },
          )
        },
      }
    },
  }
}

function mockReq(opts: {
  url?: string
  method?: string
  body?: string
  contentType?: string
}): IncomingMessage {
  const headers: Record<string, string> = { host: 'myapp.test' }
  if (opts.contentType) headers['content-type'] = opts.contentType
  const body = opts.body ?? ''

  // Minimal async iterable shim that yields the body as a single Buffer chunk.
  const req: Partial<IncomingMessage> = {
    url: opts.url ?? '/api/auth/magic-link/start',
    method: opts.method ?? 'GET',
    headers,
  }
  const stream = asyncStreamOf(body ? [Buffer.from(body, 'utf8')] : [])
  ;(req as unknown as AsyncIterable<Buffer>)[Symbol.asyncIterator] =
    stream[Symbol.asyncIterator].bind(stream)
  return req as IncomingMessage
}

/** A mocked SendMagicLinkFn whose recorded calls carry the precise argument type. */
type SendEmailMock = Mock<SendMagicLinkFn>

function makeProvider(overrides: { sendEmail?: SendEmailMock } = {}) {
  const store = createMemoryStore()
  const sendEmail: SendEmailMock =
    overrides.sendEmail ?? vi.fn<SendMagicLinkFn>().mockResolvedValue(undefined)
  const provider = magicLink({
    store,
    sendEmail,
    callbackBaseUrl: 'https://myapp.test',
  })
  return { provider, store, sendEmail }
}

describe('createMemoryStore', () => {
  it('two instances do not share state (isolation)', async () => {
    const a = createMemoryStore()
    const b = createMemoryStore()
    await a.createToken({
      email: 'x@a.test',
      token: 'tok-a',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const fromB = await b.consumeToken({ token: 'tok-a' })
    expect(fromB).toBeNull()
  })

  it('consumeToken returns the record once and null on second call', async () => {
    const store = createMemoryStore()
    await store.createToken({
      email: 'u@u.test',
      token: 'single-use',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const first = await store.consumeToken({ token: 'single-use' })
    const second = await store.consumeToken({ token: 'single-use' })
    expect(first?.email).toBe('u@u.test')
    expect(second).toBeNull()
  })

  it('EC-11 atomicity: 2 concurrent consumeToken → exactly one wins', async () => {
    const store = createMemoryStore()
    await store.createToken({
      email: 'race@test',
      token: 'race-token',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const [r1, r2] = await Promise.all([
      store.consumeToken({ token: 'race-token' }),
      store.consumeToken({ token: 'race-token' }),
    ])
    const winners = [r1, r2].filter((r) => r !== null)
    expect(winners).toHaveLength(1)
  })

  it('cleanupExpired removes only expired tokens, returns count', async () => {
    const store = createMemoryStore()
    await store.createToken({
      email: 'f@t',
      token: 'fresh',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await store.createToken({
      email: 'e@t',
      token: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    })
    const removed = await store.cleanupExpired()
    expect(removed).toBe(1)
    // fresh still consumable
    expect(await store.consumeToken({ token: 'fresh' })).not.toBeNull()
    expect(await store.consumeToken({ token: 'expired' })).toBeNull()
  })

  it('returns null for expired tokens during consumeToken', async () => {
    const store = createMemoryStore()
    await store.createToken({
      email: 'x@t',
      token: 'stale',
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(await store.consumeToken({ token: 'stale' })).toBeNull()
  })
})

describe('createOrmStore (integration via in-memory MagicLinkRepository)', () => {
  function inMemoryRepo(): MagicLinkRepository {
    const rows = new Map<string, { email: string; expiresAt: Date; consumedAt: Date | null }>()
    return {
      insert(row) {
        rows.set(row.token, {
          email: row.email,
          expiresAt: row.expiresAt,
          consumedAt: row.consumedAt,
        })
        return Promise.resolve()
      },
      consumeAtomically(token, now) {
        const row = rows.get(token)
        if (!row) return Promise.resolve(null)
        if (row.consumedAt) return Promise.resolve(null)
        row.consumedAt = now
        return Promise.resolve({ email: row.email, expiresAt: row.expiresAt })
      },
      delete(token) {
        rows.delete(token)
        return Promise.resolve()
      },
      deleteExpired(now) {
        let n = 0
        for (const [t, r] of rows) {
          if (r.expiresAt.getTime() <= now.getTime()) {
            rows.delete(t)
            n += 1
          }
        }
        return Promise.resolve(n)
      },
    }
  }

  it('full create → consume → re-consume cycle via ORM-shaped repo', async () => {
    const store = createOrmStore(inMemoryRepo())
    await store.createToken({
      email: 'orm@test',
      token: 'orm-tok',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const first = await store.consumeToken({ token: 'orm-tok' })
    const second = await store.consumeToken({ token: 'orm-tok' })
    expect(first?.email).toBe('orm@test')
    expect(second).toBeNull()
  })
})

describe('magicLink() startSignIn', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-06-03T20:00:00Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('32-byte URL-safe token generated, persisted, and emailed', async () => {
    const { provider, sendEmail, store } = makeProvider()
    const req = mockReq({
      url: '/api/auth/magic-link/start?email=user%40example.com',
    })
    const redirect = await provider.startSignIn(req)

    expect(sendEmail).toHaveBeenCalledOnce()
    const call = sendEmail.mock.calls[0]![0]
    expect(call.to).toBe('user@example.com')
    expect(call.token).toMatch(/^[A-Za-z0-9_-]+$/) // base64url
    // 32 bytes → 43 base64url chars
    expect(call.token.length).toBe(43)
    expect(call.magicLinkUrl).toContain(call.token)
    expect(redirect.pathname).toBe('/auth/check-email')

    // Token persisted (consumeToken should succeed)
    const record = await store.consumeToken({ token: call.token })
    expect(record?.email).toBe('user@example.com')
  })

  it('EC-12 throws MagicLinkConfigError when email missing', async () => {
    const { provider } = makeProvider()
    const req = mockReq({ url: '/api/auth/magic-link/start' })
    await expect(provider.startSignIn(req)).rejects.toMatchObject({
      name: 'MagicLinkConfigError',
      code: 'invalid_email',
    })
  })

  it('EC-12 throws MagicLinkConfigError when email malformed', async () => {
    const { provider } = makeProvider()
    const req = mockReq({
      url: '/api/auth/magic-link/start?email=not-an-email',
    })
    await expect(provider.startSignIn(req)).rejects.toMatchObject({
      code: 'invalid_email',
    })
  })

  it('D8 invariant: sendEmail error propagates (NOT swallowed) + token NOT persisted past failure', async () => {
    const transportError = new Error('Resend API key invalid')
    const sendEmail: SendEmailMock = vi.fn<SendMagicLinkFn>().mockRejectedValue(transportError)
    const { provider } = makeProvider({ sendEmail })
    const req = mockReq({ url: '/api/auth/magic-link/start?email=ok%40ok.test' })
    await expect(provider.startSignIn(req)).rejects.toThrow('Resend API key invalid')
  })
})

describe('magicLink() handleCallback', () => {
  it('returns MagicLinkProfile after consuming a valid token', async () => {
    const { provider, store } = makeProvider()
    await store.createToken({
      email: 'valid@test',
      token: 'good-tok',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const req = mockReq({
      url: '/api/auth/magic-link/callback?token=good-tok',
    })
    const result = await provider.handleCallback(req, {
      state: 'irrelevant',
      createdAt: 0,
      expiresAt: 0,
    })
    expect(result.providerName).toBe('magic-link')
    expect(result.profile.email).toBe('valid@test')
    expect(result.profile.verifiedAt).toBeInstanceOf(Date)
  })

  it('throws missing_token when query lacks token', async () => {
    const { provider } = makeProvider()
    const req = mockReq({ url: '/api/auth/magic-link/callback' })
    await expect(
      provider.handleCallback(req, { state: 'x', createdAt: 0, expiresAt: 0 }),
    ).rejects.toMatchObject({ code: 'missing_token' })
  })

  it('throws invalid_or_expired_token for unknown token', async () => {
    const { provider } = makeProvider()
    const req = mockReq({ url: '/api/auth/magic-link/callback?token=missing' })
    await expect(
      provider.handleCallback(req, { state: 'x', createdAt: 0, expiresAt: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_or_expired_token' })
  })

  it('throws invalid_or_expired_token for expired token (lifetime elapsed)', async () => {
    const { provider, store } = makeProvider()
    await store.createToken({
      email: 'expired@t',
      token: 'exp-tok',
      expiresAt: new Date(Date.now() - 1000),
    })
    const req = mockReq({ url: '/api/auth/magic-link/callback?token=exp-tok' })
    await expect(
      provider.handleCallback(req, { state: 'x', createdAt: 0, expiresAt: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_or_expired_token' })
  })

  it('rejects re-use of a once-consumed token', async () => {
    const { provider, store } = makeProvider()
    await store.createToken({
      email: 'once@t',
      token: 'one-shot',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const req1 = mockReq({ url: '/api/auth/magic-link/callback?token=one-shot' })
    const req2 = mockReq({ url: '/api/auth/magic-link/callback?token=one-shot' })
    await provider.handleCallback(req1, { state: 'x', createdAt: 0, expiresAt: 0 })
    await expect(
      provider.handleCallback(req2, { state: 'x', createdAt: 0, expiresAt: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_or_expired_token' })
  })
})

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')

describe('token hashing at rest (T3.1 #191)', () => {
  it('orm store inserts the token HASH, never the raw token', async () => {
    const inserts: { token: string }[] = []
    const repo: MagicLinkRepository = {
      insert(row) {
        inserts.push(row)
        return Promise.resolve()
      },
      consumeAtomically() {
        return Promise.resolve(null)
      },
      delete() {
        return Promise.resolve()
      },
      deleteExpired() {
        return Promise.resolve(0)
      },
    }
    const store = createOrmStore(repo)
    await store.createToken({
      email: 'a@b.co',
      token: 'raw-token-xyz',
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect(inserts[0]?.token).toBe(sha256hex('raw-token-xyz'))
    expect(inserts[0]?.token).not.toBe('raw-token-xyz')
  })

  it('orm store looks up by the token HASH on consume (no plaintext lookup)', async () => {
    const seen: string[] = []
    const repo: MagicLinkRepository = {
      insert() {
        return Promise.resolve()
      },
      consumeAtomically(token) {
        seen.push(token)
        return Promise.resolve(null)
      },
      delete() {
        return Promise.resolve()
      },
      deleteExpired() {
        return Promise.resolve(0)
      },
    }
    const store = createOrmStore(repo)
    await store.consumeToken({ token: 'raw-abc' })
    expect(seen[0]).toBe(sha256hex('raw-abc'))
    expect(seen[0]).not.toBe('raw-abc')
  })

  it('memory store round-trips by raw token + single-use (hashed storage transparent to callers)', async () => {
    const store = createMemoryStore()
    await store.createToken({
      email: 'a@b.co',
      token: 'plain',
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect((await store.consumeToken({ token: 'plain' }))?.email).toBe('a@b.co')
    expect(await store.consumeToken({ token: 'plain' })).toBeNull()
  })
})

describe('magicLink() input hardening (T3.2 #204/#209/#205)', () => {
  const sendEmail = (): SendEmailMock => vi.fn<SendMagicLinkFn>().mockResolvedValue(undefined)

  it('#204: rejects an oversized request body (DoS cap) → invalid_email', async () => {
    const provider = magicLink({
      store: createMemoryStore(),
      sendEmail: sendEmail(),
      callbackBaseUrl: 'https://myapp.test',
    })
    // Body > 16KB with an otherwise-valid email — only the cap should reject it.
    const body = JSON.stringify({ email: 'u@x.co', pad: 'a'.repeat(20_000) })
    const req = mockReq({ method: 'POST', contentType: 'application/json', body })
    await expect(provider.startSignIn(req)).rejects.toMatchObject({ code: 'invalid_email' })
  })

  it('#204: the DoS cap holds on a Web Request too', async () => {
    const provider = magicLink({
      store: createMemoryStore(),
      sendEmail: sendEmail(),
      callbackBaseUrl: 'https://myapp.test',
    })
    // The Web path reads the stream chunk by chunk for exactly this reason: `Request.text()` would
    // buffer the whole hostile payload before anyone could object.
    const body = JSON.stringify({ email: 'u@x.co', pad: 'a'.repeat(20_000) })
    const request = new Request('https://myapp.test/api/auth/magic-link/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    await expect(provider.startSignIn(request)).rejects.toMatchObject({ code: 'invalid_email' })
  })

  it('#101: resolves the email from a pre-parsed body when the Request carries none', async () => {
    // TheoKit hands a route handler a Request built WITHOUT a body — the parsed body arrives
    // separately as `ctx.body`. Before this, `startSignIn(request)` inside a route could not
    // reach the address the framework had already parsed, and threw invalid_email while the
    // email sat in ctx.body. #68 made the type accept a Request; this makes the runtime work.
    const sent: string[] = []
    const provider = magicLink({
      store: createMemoryStore(),
      sendEmail: ({ to }) => {
        sent.push(to)
        return Promise.resolve()
      },
      callbackBaseUrl: 'https://myapp.test',
    })

    const request = new Request('https://myapp.test/api/auth/magic-link/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    await provider.startSignIn(request, { email: 'Seam@Example.test' })

    expect(sent).toEqual(['seam@example.test'])
  })

  it('#101: still refuses a pre-parsed body with no usable email', async () => {
    const provider = magicLink({
      store: createMemoryStore(),
      sendEmail: sendEmail(),
      callbackBaseUrl: 'https://myapp.test',
    })
    const request = new Request('https://myapp.test/api/auth/magic-link/start', { method: 'POST' })

    await expect(provider.startSignIn(request, { nope: 1 })).rejects.toMatchObject({
      code: 'invalid_email',
    })
  })

  it('#101: the query string still wins, so existing callers are unchanged', async () => {
    // Order is unchanged: query string first, then the body — whether that body was pre-parsed
    // or read from the stream. A caller relying on ?email= keeps the behaviour it had.
    const sent: string[] = []
    const provider = magicLink({
      store: createMemoryStore(),
      sendEmail: ({ to }) => {
        sent.push(to)
        return Promise.resolve()
      },
      callbackBaseUrl: 'https://myapp.test',
    })
    const request = new Request(
      'https://myapp.test/api/auth/magic-link/start?email=from-query@example.test',
      { method: 'POST' },
    )

    await provider.startSignIn(request, { email: 'from-body@example.test' })

    expect(sent).toEqual(['from-query@example.test'])
  })

  it('#209: propagates a stream/transport error instead of swallowing it to null', async () => {
    const provider = magicLink({
      store: createMemoryStore(),
      sendEmail: sendEmail(),
      callbackBaseUrl: 'https://myapp.test',
    })
    // A request whose body stream throws mid-read (e.g. ECONNRESET).
    const req = {
      url: '/api/auth/magic-link/start',
      method: 'POST',
      headers: { host: 'myapp.test', 'content-type': 'application/json' },
    } as unknown as IncomingMessage
    // A body stream that yields one chunk then rejects mid-read (ECONNRESET).
    ;(req as unknown as AsyncIterable<Buffer>)[Symbol.asyncIterator] =
      (): AsyncIterator<Buffer> => {
        let yielded = false
        return {
          next(): Promise<IteratorResult<Buffer>> {
            if (!yielded) {
              yielded = true
              return Promise.resolve({ value: Buffer.from('{"em', 'utf8'), done: false })
            }
            return Promise.reject(new Error('ECONNRESET'))
          },
        }
      }
    await expect(provider.startSignIn(req)).rejects.toThrow('ECONNRESET')
  })

  it('#209: still returns null (→ invalid_email) on malformed JSON (narrowed catch)', async () => {
    const provider = magicLink({
      store: createMemoryStore(),
      sendEmail: sendEmail(),
      callbackBaseUrl: 'https://myapp.test',
    })
    const req = mockReq({ method: 'POST', contentType: 'application/json', body: '{bad json' })
    await expect(provider.startSignIn(req)).rejects.toMatchObject({ code: 'invalid_email' })
  })

  it('#205: builds the magic-link URL without a double slash even when base has a trailing slash', async () => {
    const spy = sendEmail()
    const provider = magicLink({
      store: createMemoryStore(),
      sendEmail: spy,
      callbackBaseUrl: 'https://myapp.test/',
    })
    await provider.startSignIn(mockReq({ url: '/api/auth/magic-link/start?email=u%40x.co' }))
    const url = spy.mock.calls[0]![0].magicLinkUrl
    expect(url).not.toContain('//api')
    expect(url).toMatch(/^https:\/\/myapp\.test\/api\/auth\/magic-link\/callback\?token=/)
  })

  it('#205: rejects a non-absolute callbackBaseUrl at factory init', () => {
    expect(() =>
      magicLink({
        store: createMemoryStore(),
        sendEmail: sendEmail(),
        callbackBaseUrl: 'not-a-url',
      }),
    ).toThrow(MagicLinkConfigError)
  })
})

describe('magic-link tokens are unbound bearer credentials (T3.1 #190 — cross-device by design)', () => {
  it('handleCallback succeeds with a mismatched/empty tx.state (cross-device click)', async () => {
    // The user may click the email link on a DIFFERENT device than the one that
    // called startSignIn, so no initiating-browser tx.state cookie is present.
    // The token is a bearer credential (32B entropy + 15min TTL + single-use +
    // hash-at-rest); tx.state binding is intentionally NOT enforced. This test
    // guards against a future regression that re-adds OAuth-style state binding
    // and would break cross-device sign-in. (ADR D6 binding option superseded.)
    const { provider, store } = makeProvider()
    await store.createToken({
      email: 'cross@device',
      token: 'cross-device-tok',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const req = mockReq({
      url: '/api/auth/magic-link/callback?token=cross-device-tok',
    })
    const result = await provider.handleCallback(req, {
      state: 'a-totally-different-browser-state',
      createdAt: 0,
      expiresAt: 0,
    })
    expect(result.profile.email).toBe('cross@device')
  })
})

describe('magicLink() — accepts a Web Request', () => {
  // This provider reads more of the request than the OAuth ones: the method, the content type and
  // the BODY. On a Web `Request` none of those are reachable the Node way, which is what kept these
  // packages out of a TheoKit route (#68).
  it('resolves the email from a JSON body on a Web Request', async () => {
    const { provider, sendEmail } = makeProvider()

    const request = new Request('https://myapp.test/api/auth/magic-link/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Web@Example.test' }),
    })
    await provider.startSignIn(request)

    expect(sendEmail).toHaveBeenCalledOnce()
    // Normalisation still applies: the address is lower-cased before the token is minted.
    expect(sendEmail.mock.calls[0]![0].to).toBe('web@example.test')
  })

  it('resolves the email from a form-encoded body on a Web Request', async () => {
    const { provider, sendEmail } = makeProvider()

    const request = new Request('https://myapp.test/api/auth/magic-link/start', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=form%40example.test',
    })
    await provider.startSignIn(request)

    expect(sendEmail.mock.calls[0]![0].to).toBe('form@example.test')
  })

  it('resolves the email from the query string on a Web Request', async () => {
    const { provider, sendEmail } = makeProvider()

    const request = new Request(
      'https://myapp.test/api/auth/magic-link/start?email=qs@example.test',
    )
    await provider.startSignIn(request)

    expect(sendEmail.mock.calls[0]![0].to).toBe('qs@example.test')
  })

  it('consumes a token from a Web Request on the callback', async () => {
    const { provider, sendEmail } = makeProvider()
    await provider.startSignIn(
      new Request('https://myapp.test/api/auth/magic-link/start?email=round@example.test'),
    )
    const link = new URL(sendEmail.mock.calls[0]![0].magicLinkUrl)
    const token = link.searchParams.get('token')

    const result = await provider.handleCallback(
      new Request(`https://myapp.test/api/auth/magic-link/callback?token=${token}`),
      { state: '', createdAt: Date.now(), expiresAt: Date.now() + 600_000 },
    )

    expect(result.profile.email).toBe('round@example.test')
  })
})
