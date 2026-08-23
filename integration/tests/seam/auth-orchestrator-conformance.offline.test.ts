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

import { createServer, type IncomingMessage, type Server } from 'node:http'
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

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/.well-known/openid-configuration') {
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
  process.env.NODE_ENV = 'test'
  process.env.MOCK_GOOGLE_OIDC_BASE_URL = baseUrl
})

afterAll(async () => {
  delete process.env.MOCK_GOOGLE_OIDC_BASE_URL
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

    // Asserted as "rejects", then asserted NOT to be the PKCE precondition: `auth-google` throws
    // GoogleAuthError('missing_pkce_verifier') before doing anything else when a transaction has
    // no verifier, and a case that passed on that would be vacuous — it would "fail" for every
    // provider, working or broken.
    await expect(result).rejects.toThrow()
    await expect(result).rejects.not.toThrow(/missing_pkce_verifier/)
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

    expect(location, 'startSignIn returned no redirect').toBeTruthy()
    // The host comes from the LOCAL discovery document. If discovery silently fell back to
    // Google, this reads accounts.google.com and fails — which is the point.
    expect(new URL(location!).host).toBe(LOCAL_AUTHORIZE_HOST)
    expect(new URL(location!).searchParams.get('client_id')).toBe('conformance-client-id')
  })
})
