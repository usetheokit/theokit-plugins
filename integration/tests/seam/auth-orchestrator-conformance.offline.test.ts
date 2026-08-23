/**
 * `auth-google`, driven by the orchestrator TheoKit actually uses.
 *
 * B-001's DoD names "the `AuthProvider` contract from `@theokit/sdk/server/auth`" as the surface
 * to test against. Measured, `AuthProvider` is an `export type` — the module's runtime exports
 * are `defineAuth`, `validateReturnTo` and five error classes. Nothing can be handed to a type,
 * so this suite targets `defineAuth` instead, and the DoD is corrected rather than satisfied
 * literally.
 *
 * Constructing the orchestrator is NOT the test. Probed directly against the installed sdk,
 * `defineAuth({ session, providers: [{ name: 'broken' }] })` returns the full five-method
 * surface without complaint. A test that asserted the orchestrator was defined would therefore
 * pass for a provider that cannot work. So the orchestrator is driven: `startSignIn` is what
 * makes the provider's own `createAuthorizationURL` run.
 *
 * Discovery is served from loopback. `packages/auth-google/src/index.ts` calls
 * `discoverOidcProvider(baseUrl)` inside `createAuthorizationURL` — a real network fetch — and
 * this suite gates every pull request, so hitting Google would make a conformance failure and a
 * Google outage look identical. `resolveOidcBaseUrl` ships a deliberate loopback-only override
 * for exactly this case; the assertion below checks the redirect host is the one the LOCAL
 * document declared, so a silent fallback to the real endpoint fails rather than passes.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { type AddressInfo } from 'node:net'

import { google } from '@theokit/auth-google'
import { defineAuth } from '@theokit/sdk/server/auth'
import { createSessionManager } from 'theokit/server/auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Host the local discovery document points its authorization endpoint at. */
const LOCAL_AUTHORIZE_HOST = 'oidc.localtest.invalid'

interface Session {
  readonly userId: string
}

let server: Server
let baseUrl: string
let previousNodeEnv: string | undefined
let previousMockBase: string | undefined
let discoveryHits = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/.well-known/openid-configuration') {
      discoveryHits += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          issuer: baseUrl,
          // https, because the provider rejects a non-https authorization_endpoint before
          // building the redirect (#192, open-redirect guard). The host is what the assertion
          // reads — it is never fetched.
          authorization_endpoint: `https://${LOCAL_AUTHORIZE_HOST}/o/oauth2/v2/auth`,
          token_endpoint: `https://${LOCAL_AUTHORIZE_HOST}/token`,
          userinfo_endpoint: `https://${LOCAL_AUTHORIZE_HOST}/userinfo`,
          jwks_uri: `https://${LOCAL_AUTHORIZE_HOST}/certs`,
        }),
      )
      return
    }
    res.writeHead(404).end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`

  // The override is honored only for loopback and only under NODE_ENV=test — the package's own
  // SSRF guard. Both conditions are met deliberately here.
  previousNodeEnv = process.env.NODE_ENV
  previousMockBase = process.env.MOCK_GOOGLE_OIDC_BASE_URL
  process.env.NODE_ENV = 'test'
  process.env.MOCK_GOOGLE_OIDC_BASE_URL = baseUrl
})

afterAll(async () => {
  // Both process globals are restored, not merely one. Measured: vitest isolates process.env per
  // test file here, so nothing leaks today — but `rules/testing.md § 3` asks for independence
  // from the test, not from the runner's current configuration. `isolate: false` or a different
  // pool would turn this into an order-dependency that only shows up as a confusing failure
  // somewhere else.
  if (previousMockBase === undefined) delete process.env.MOCK_GOOGLE_OIDC_BASE_URL
  else process.env.MOCK_GOOGLE_OIDC_BASE_URL = previousMockBase
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/**
 * The minimum an `IncomingMessage` needs to be for the orchestrator to read it.
 *
 * `startSignIn(providerName, req)` takes a Node request, not a WHATWG `Request` — learned from
 * the seam itself, which answered a `Request` with
 * `AuthProviderNotFoundError: '[object Request]'`. That error is worth recording: it names the
 * provider lookup, not the argument type, so the same mistake in a consumer's route would read
 * as a registration problem.
 */
function incomingRequest(url = '/auth/google'): IncomingMessage {
  return { url, method: 'GET', headers: { host: 'app.invalid' } } as IncomingMessage
}

/**
 * A `ServerResponse` that records instead of writing. `finishSignIn` sets the session cookie on
 * it; recording rather than ignoring means the round-trip case can say what came back if it ever
 * gets that far.
 */
function collectingResponse(): ServerResponse {
  const headers = new Map<string, unknown>()
  return {
    setHeader: (name: string, value: unknown) => headers.set(name, value),
    getHeader: (name: string) => headers.get(name),
    writeHead: () => undefined,
    end: () => undefined,
  } as unknown as ServerResponse
}

function orchestratorFor(provider: unknown) {
  return defineAuth<Session>({
    // `createSessionManager`, not `createSessionManagerWeb`. The Web variant is WHATWG-shaped
    // (Request/Headers) while the sdk's `SessionManager` is Node-shaped
    // (IncomingMessage/ServerResponse), so the two do not interchange — tsc caught the swap. The
    // session is not what this suite tests; it is the argument `defineAuth` requires.
    session: createSessionManager<Session>({
      secret: 'conformance-only-secret-at-least-32-chars-long',
    }),
    providers: [provider as never],
    onSignIn: ({ profile }) =>
      Promise.resolve({ userId: (profile as { sub?: string }).sub ?? 'conformance-user' }),
  })
}

describe('the real auth orchestrator is what drives a provider', () => {
  it('accepts a provider that cannot work, so construction proves nothing', () => {
    // Recorded because it is the reason this file drives the orchestrator instead of building
    // one. If a future sdk starts validating here, this test fails and the suite below can be
    // simplified — that is a good failure, not a regression.
    expect(orchestratorFor({ name: 'broken' })).toBeDefined()
  })

  it('fails a provider that cannot build an authorization URL', async () => {
    const result = orchestratorFor({ name: 'broken' }).startSignIn('broken', incomingRequest())

    // Asserted by class AND message, per `rules/testing.md § 4.1`. A bare `rejects.toThrow()`
    // was measured to be blind in the way that matters: mutating the call to
    // `startSignIn('brokn', …)` — a provider-lookup miss, not a seam failure — kept it green,
    // failing with `AuthProviderNotFoundError`. That is the very error this file's own docstring
    // records as misleading, so the test would have been blind to the trap it documents.
    await expect(result).rejects.toThrow(TypeError)
    await expect(result).rejects.toThrow(/createAuthorizationURL is not a function/)
  })

  it('drives google through to its own authorization URL', async () => {
    const orchestrator = orchestratorFor(
      google({
        clientId: 'conformance-client-id',
        clientSecret: 'conformance-client-secret',
        redirectUri: 'https://app.invalid/auth/google/callback',
      }),
    )

    const response = await orchestrator.startSignIn('google', incomingRequest())
    const location = response.headers.get('location')

    expect(response.status).toBe(302)
    expect(location, 'startSignIn returned no redirect').toBeTruthy()

    const url = new URL(location!)
    // The host comes from the LOCAL discovery document. If discovery silently fell back to
    // Google, this reads accounts.google.com and fails — which is the point. The hit counter is
    // what turns that from a claim into a measurement: `discoverOidcProvider` memoizes at module
    // scope and `clearOidcCache` is never called in this repository, so "it used our document"
    // and "it used a cached one" are otherwise indistinguishable.
    expect(url.host).toBe(LOCAL_AUTHORIZE_HOST)
    expect(discoveryHits, 'the local discovery document was never fetched').toBeGreaterThan(0)

    // All seven parameters the provider sets, not one. A provider that dropped `state` or
    // downgraded `code_challenge_method` to `plain` passed the earlier version of this test
    // unchanged — and those are the two that carry the CSRF and PKCE guarantees.
    expect(url.searchParams.get('client_id')).toBe('conformance-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.invalid/auth/google/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBeTruthy()
    expect(url.searchParams.get('state'), 'no state — CSRF guard absent').toBeTruthy()
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    // The transaction cookie's security attributes have no coverage anywhere else in this
    // repository — measured with a grep across `packages/` and `integration/`. This is the only
    // test that drives `startSignIn`, so it is the only place they can be asserted.
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie, 'startSignIn set no transaction cookie').toBeTruthy()
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/Secure/)
    expect(setCookie).toMatch(/SameSite=Lax/)
  })

  it.fails(
    'completes the round trip: the cookie startSignIn sets is one finishSignIn can read',
    async () => {
      // `it.fails` — NOT a skip. It passes while the body throws and turns RED the moment the body
      // succeeds, which is exactly the signal wanted here: the defect is upstream, and this test is
      // what tells us when it is gone.
      //
      // Measured against @theokit/sdk@2.18.0: `startSignIn` writes `theo_oauth_tx=...` (index.js:249)
      // while the transaction store reads `__Host-theo_oauth_tx` (index.js:107). The cookie is
      // therefore never found, and EVERY OAuth sign-in driven through `defineAuth` fails at the
      // callback with AuthCallbackError. Reproduced end to end before writing this.
      //
      // Filed as B-019. A conformance suite that stopped at the 302 would certify half a round trip
      // — which is the failure mode this file's own docstring argues against.
      //
      // The provider here is deliberately minimal: what is under test is the ORCHESTRATOR's cookie
      // handling, not a package's provider logic. Driving `auth-google` this far would need a token
      // endpoint too, and would tell us about Google's leg rather than the seam's.
      const provider = {
        name: 'roundtrip',
        createAuthorizationURL: (tx: { state: string }) =>
          Promise.resolve(new URL(`https://${LOCAL_AUTHORIZE_HOST}/a?state=${tx.state}`)),
        handleCallback: () => Promise.resolve({ profile: { sub: 'round-trip-user' } }),
      }
      const orchestrator = orchestratorFor(provider)

      const started = await orchestrator.startSignIn(
        'roundtrip',
        incomingRequest('/auth/roundtrip'),
      )
      const cookie = started.headers.get('set-cookie')!.split(';')[0]
      const state = new URL(started.headers.get('location')!).searchParams.get('state')

      await orchestrator.finishSignIn(
        'roundtrip',
        {
          url: `/auth/roundtrip/callback?code=any&state=${state}`,
          method: 'GET',
          headers: { host: 'app.invalid', cookie },
        } as IncomingMessage,
        collectingResponse(),
      )
    },
  )
})
