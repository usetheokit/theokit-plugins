/**
 * The seam this repository's auth packages actually integrate through: a TheoKit route.
 *
 * #68 shipped because nothing exercised it. Every auth suite here drives a provider directly with a
 * hand-built `IncomingMessage`, which agrees with whoever wrote the provider and never touches the
 * framework — so a provider that could not be wired into a route at all kept CI green for months.
 *
 * This suite crosses that boundary. It builds the same `RouteConfig` a consumer writes, invokes its
 * handler the way `executeRoute` does, and asserts the whole chain: a Web `Request` in, the profile
 * resolved by the provider, and a session cookie on the `Response` out. Nothing here is mocked
 * except the identity provider's own HTTP.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 *
 * WHAT THIS SUITE DOES NOT BITE ON, measured by mutation rather than assumed. Deleting the Web
 * branch from the OAuth providers' URL parsing leaves all four tests green: feeding a `Request`
 * through the Node path builds `http://localhost` + an absolute URL, which parses to the garbage
 * host `localhosthttps` and keeps the query string intact — and those providers read nothing but
 * `searchParams`. For github and google the guard against regressing to Node-only is therefore
 * `pnpm typecheck`, not this file; narrowing their public signature back fails the build with two
 * errors. What this file does kill is the magic-link path, which reads the request BODY and has no
 * such accident to hide behind: breaking it turns the last test red.
 */

import { github } from '@theokit/auth-github'
import { magicLink, createMemoryStore } from '@theokit/auth-magic-link'
import { route } from 'theokit/server'
import { createSessionManagerWeb } from 'theokit/server/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

/** Invoke a built route the way TheoKit's runtime does: the ctx it passes, nothing more. */
async function invoke(
  config: { handler: (ctx: never) => unknown },
  request: Request,
): Promise<Response> {
  const ctx = {
    query: undefined,
    body: undefined,
    params: undefined,
    request,
    ctx: {},
  } as never
  return (await config.handler(ctx)) as Response
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

  const CALLBACK = route()
    .handler(async ({ request }) => {
      const { profile } = await provider.handleCallback(request, TX)
      const headers = new Headers()
      await sessions.createSession(headers, {
        userId: String(profile.id),
        email: profile.email ?? '',
      })
      headers.set('location', '/')
      return new Response(null, { status: 302, headers })
    })
    .build()

  it('turns the callback Request into a session cookie', async () => {
    fetchSpy
      .mockResolvedValueOnce(json({ access_token: 'gho_seam', token_type: 'bearer' }))
      .mockResolvedValueOnce(json({ id: 7, login: 'seam', email: 'seam@github.test' }))

    const response = await invoke(
      CALLBACK,
      new Request(`https://myapp.test/api/auth/github/callback?code=c&state=${TX.state}`),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/')
    expect(response.headers.get('set-cookie')).toBeTruthy()
  })

  it('round-trips: the cookie it sets is a session it can read back', async () => {
    fetchSpy
      .mockResolvedValueOnce(json({ access_token: 'gho_seam', token_type: 'bearer' }))
      .mockResolvedValueOnce(json({ id: 7, login: 'seam', email: 'seam@github.test' }))

    const response = await invoke(
      CALLBACK,
      new Request(`https://myapp.test/api/auth/github/callback?code=c&state=${TX.state}`),
    )

    // A Set-Cookie nobody can decrypt would satisfy the assertion above and sign nobody in.
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    const session = await sessions.getSession(
      new Request('https://myapp.test/', { headers: { cookie } }),
    )

    expect(session).toEqual({ userId: '7', email: 'seam@github.test' })
  })

  it('refuses a forged state, so the route cannot mint a session from it', async () => {
    const response = invoke(
      CALLBACK,
      new Request('https://myapp.test/api/auth/github/callback?code=c&state=forged'),
    )

    await expect(response).rejects.toThrow(/state/i)
    expect(fetchSpy, 'a rejected state must not reach the token endpoint').not.toHaveBeenCalled()
  })
})

describe('the magic-link provider inside a TheoKit route', () => {
  it('mints a link on the start leg and signs in on the callback leg', async () => {
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
      .handler(async ({ request }) => {
        const redirect = await provider.startSignIn(request)
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

    // The start leg reads the address from the request BODY — the part that broke on a Request.
    const started = await invoke(
      START,
      new Request('https://myapp.test/api/auth/magic-link/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Seam@Example.test' }),
      }),
    )
    expect(started.status).toBe(303)
    expect(sent).toHaveLength(1)

    const token = sent[0]!.searchParams.get('token')
    const signedIn = await invoke(
      CALLBACK,
      new Request(`https://myapp.test/api/auth/magic-link/callback?token=${token}`),
    )

    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!
    const session = await sessions.getSession(
      new Request('https://myapp.test/', { headers: { cookie } }),
    )
    expect(session).toEqual({ userId: 'seam@example.test', email: 'seam@example.test' })
  })
})
