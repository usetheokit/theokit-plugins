/**
 * The seam this repository's auth packages actually integrate through: a TheoKit route.
 *
 * #68 shipped because nothing exercised it. Every auth suite here drives a provider directly with a
 * hand-built `IncomingMessage`, which agrees with whoever wrote the provider and never touches the
 * framework — so a provider that could not be wired into a route at all kept CI green for months.
 *
 * This suite crosses that boundary for real. A live `node:http` server calls TheoKit's own
 * `executeRoute`, and the tests make ordinary HTTP requests against it. Nothing is mocked except
 * the identity provider's outbound HTTP.
 *
 * It used to call `config.handler(ctx)` directly through a hand-written shim, and the shim was
 * more permissive than the framework in ways that hid three real defects:
 *
 *   - it put the test's own body-carrying `Request` on `ctx.request`, while TheoKit puts a
 *     BODYLESS request there and delivers the parsed body as `ctx.body`. The magic-link start
 *     leg reads the body, so the assertion the file called load-bearing passed on an accident,
 *     and the composition it documented could not serve a request at all (#76, fixed in the
 *     package as #101)
 *   - it never ran the CSRF stage, so a POST route with no `csrf: false` looked composable while
 *     a real consumer got 403 before the handler (#78)
 *   - it saw the handler's throw, not the response. A rejected state answers 500 with the
 *     internal message echoed to the caller, and `rejects.toThrow(/state/i)` cannot see either
 *     the status class or the leak (#95)
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { github } from '@theokit/auth-github'
import { magicLink, createMemoryStore } from '@theokit/auth-magic-link'
import { route } from 'theokit/server'
import { createSessionManagerWeb } from 'theokit/server/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withRoute } from '../../src/route-harness.js'

interface Session {
  userId: string
  email: string
}

/** 32 bytes, fixed: this is a test vector, never a credential. */
const SESSION_SECRET = 'test-session-secret-0123456789ab'

/** Structurally an `OAuthTransaction`; `handleCallback`'s signature is what enforces the shape. */
const TX = {
  state: 'state-from-the-start-leg',
  createdAt: Date.now(),
  expiresAt: Date.now() + 600_000,
}

const sessions = createSessionManagerWeb<Session>({ secret: SESSION_SECRET })

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** The one cookie header a Set-Cookie response yields, ready to send back. */
function cookieFrom(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers['set-cookie']
  const first = Array.isArray(raw) ? raw[0] : raw
  return first!.split(';')[0]!
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('an OAuth provider inside a TheoKit route', () => {
  const provider = github({
    clientId: 'Iv1.seam',
    clientSecret: 'ghsec_seam',
    redirectUri: 'https://myapp.test/api/auth/github/callback',
  })

  /** The composition a consumer should write: provider errors mapped, internals not echoed. */
  const GET = route()
    .handler(async ({ request }) => {
      try {
        const { profile } = await provider.handleCallback(request, TX)
        const headers = new Headers()
        await sessions.createSession(headers, {
          userId: String(profile.id),
          email: profile.email ?? '',
        })
        headers.set('location', '/')
        return new Response(null, { status: 302, headers })
      } catch {
        // A rejected callback is the caller's problem, not ours, and the provider's message
        // names internals. Without this the framework answers 500 and echoes it (#95).
        return new Response('sign-in failed', { status: 400 })
      }
    })
    .build()

  function grantsAToken(): void {
    fetchSpy
      .mockResolvedValueOnce(json({ access_token: 'gho_seam', token_type: 'bearer' }))
      .mockResolvedValueOnce(json({ id: 7, login: 'seam', email: 'seam@github.test' }))
  }

  it('turns the callback request into a session cookie', async () => {
    await withRoute({ GET }, async (call) => {
      grantsAToken()

      const response = await call({ path: `/route?code=c&state=${TX.state}` })

      expect(response.status).toBe(302)
      expect(response.headers.location).toBe('/')
      expect(response.headers['set-cookie']).toBeTruthy()
    })
  })

  it('round-trips: the cookie it sets is a session it can read back', async () => {
    await withRoute({ GET }, async (call) => {
      grantsAToken()

      const response = await call({ path: `/route?code=c&state=${TX.state}` })

      // A Set-Cookie nobody can decrypt would satisfy the assertion above and sign nobody in.
      const session = await sessions.getSession(
        new Request('https://myapp.test/', { headers: { cookie: cookieFrom(response.headers) } }),
      )
      expect(session).toEqual({ userId: '7', email: 'seam@github.test' })
    })
  })

  it('answers a forged state with 4xx, without echoing the provider message', async () => {
    await withRoute({ GET }, async (call) => {
      const response = await call({ path: '/route?code=c&state=forged' })

      expect(response.status).toBe(400)
      expect(response.headers['set-cookie'], 'a forged state must not mint a session').toBeFalsy()
      expect(response.body, 'the provider message must not reach the caller').not.toMatch(/state/i)
      expect(fetchSpy, 'a rejected state must not reach the token endpoint').not.toHaveBeenCalled()
    })
  })

  it('leaks the provider message as a 500 when the handler does NOT map the error', async () => {
    // The hazard the mapping above exists for, pinned rather than described. TheoKit maps any
    // error that is not exactly AUTH_REQUIRED/401 onto `sendError(..., 'INTERNAL_ERROR',
    // err.message, 500)`, so an unmapped handler answers a client mistake with a server error
    // AND puts the provider's internal wording in the response body (#95).
    const UNMAPPED = route()
      .handler(async ({ request }) => {
        const { profile } = await provider.handleCallback(request, TX)
        return new Response(String(profile.id), { status: 200 })
      })
      .build()

    await withRoute({ GET: UNMAPPED }, async (call) => {
      const response = await call({ path: '/route?code=c&state=forged' })

      expect(response.status).toBe(500)
      expect(response.body).toMatch(/state/i)
    })
  })
})

describe('the magic-link provider inside a TheoKit route', () => {
  function wire(): {
    sent: URL[]
    START: unknown
    CALLBACK: unknown
  } {
    const sent: URL[] = []
    const provider = magicLink({
      store: createMemoryStore(),
      callbackBaseUrl: 'https://myapp.test',
      sendEmail: ({ magicLinkUrl }) => {
        sent.push(new URL(magicLinkUrl))
        return Promise.resolve()
      },
    })

    const START = route()
      .handler(async ({ request, body }) => {
        // `body`, not just `request`: TheoKit hands the handler a request with no body (#101).
        const redirect = await provider.startSignIn(request, body)
        return new Response(null, { status: 303, headers: { location: redirect.href } })
      })
      .build()

    const CALLBACK = route()
      .handler(async ({ request }) => {
        // Deliberately unbound: a magic link is cross-device, so there is no transaction to
        // match (#190). The token's entropy, TTL and single-use consumption are the guarantee.
        const { profile } = await provider.handleCallback(request, {
          state: '',
          createdAt: 0,
          expiresAt: 0,
        })
        const headers = new Headers()
        await sessions.createSession(headers, { userId: profile.email, email: profile.email })
        headers.set('location', '/')
        return new Response(null, { status: 302, headers })
      })
      .build()

    return { sent, START, CALLBACK }
  }

  const CSRF_HEADERS = { 'content-type': 'application/json', 'x-theo-action': '1' }

  it('mints a link on the start leg and signs in on the callback leg', async () => {
    const { sent, START, CALLBACK } = wire()

    const token = await withRoute({ POST: START }, async (call) => {
      const started = await call({
        method: 'POST',
        headers: CSRF_HEADERS,
        body: JSON.stringify({ email: 'Seam@Example.test' }),
      })

      expect(started.status).toBe(303)
      expect(sent).toHaveLength(1)
      return sent[0]!.searchParams.get('token')
    })

    await withRoute({ GET: CALLBACK }, async (call) => {
      const signedIn = await call({ path: `/route?token=${token}` })

      const session = await sessions.getSession(
        new Request('https://myapp.test/', { headers: { cookie: cookieFrom(signedIn.headers) } }),
      )
      expect(session).toEqual({ userId: 'seam@example.test', email: 'seam@example.test' })
    })
  })

  it('is refused with 403 before the handler when the POST carries no CSRF header', async () => {
    // The stage the shim never ran. A POST route that does not declare `csrf: false` is CSRF
    // protected, so a consumer POSTing without `X-Theo-Action: 1` never reaches the handler —
    // and the old suite reported that same composition as working (#78).
    const { sent, START } = wire()

    await withRoute({ POST: START }, async (call) => {
      const response = await call({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'seam@example.test' }),
      })

      expect(response.status).toBe(403)
      expect(response.body).toMatch(/CSRF/i)
      expect(sent, 'the handler must not have run').toHaveLength(0)
    })
  })

  it('cannot read the address when the handler forwards only the request', async () => {
    // Why the start handler passes `body`. TheoKit's request carries none, so a handler written
    // the way the README used to show it finds nothing and the framework answers 500 (#76/#101).
    const provider = magicLink({
      store: createMemoryStore(),
      callbackBaseUrl: 'https://myapp.test',
      sendEmail: () => Promise.resolve(),
    })
    const REQUEST_ONLY = route()
      .handler(async ({ request }) => {
        const redirect = await provider.startSignIn(request)
        return new Response(null, { status: 303, headers: { location: redirect.href } })
      })
      .build()

    await withRoute({ POST: REQUEST_ONLY }, async (call) => {
      const response = await call({
        method: 'POST',
        headers: CSRF_HEADERS,
        body: JSON.stringify({ email: 'seam@example.test' }),
      })

      expect(response.status).toBe(500)
      expect(response.body).toMatch(/email/i)
    })
  })
})
