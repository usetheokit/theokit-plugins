/**
 * The Google OAuth SUCCESS leg, driven end-to-end over real HTTP.
 *
 * `integration/scripts/full-flow-google.mjs` exists because this provider's success path was
 * exercised by neither CI nor a documented procedure, and its header still says the honest thing:
 * **the exchange has never completed there.** It cannot, unattended — Google issues an
 * authorization code only to a request carrying an authenticated session, and consenting an app on
 * a real Google account is a person's decision about their own identity.
 *
 * This closes as much of that as a machine can. A loopback sidecar serves discovery, `/token` and
 * `/userinfo`, and `google().handleCallback()` runs against it across a real socket:
 *
 *   discovery      the provider reaches a live document and uses ITS endpoints, not configured ones
 *   code -> tokens the PKCE exchange, over HTTP, with the form body a server actually parses
 *   id_token -> profile   the OIDC claims this provider maps
 *
 * WHAT IT STILL DOES NOT PROVE, and the distinction is the whole reason the script survives:
 * Google's REAL response shapes and its consent screen. A sidecar answers what we told it to
 * answer, so this catches our code breaking and cannot catch Google changing. The unit tests in
 * `packages/auth-google/tests/google-provider.test.ts` cover the same path with a mocked `fetch`;
 * what this adds over them is a real socket, a real form encoding, and a real server parsing it —
 * the layer where a `Content-Type` or a body-encoding bug lives, and the layer a `fetch` spy
 * cannot see.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage } from 'node:http'

import { google } from '@theokit/auth-google'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** What the sidecar received, so the assertions can be about the wire and not about a spy. */
interface Seen {
  tokenBody?: URLSearchParams
  tokenContentType?: string
  userinfoAuth?: string
  discoveryHits: number
}

const seen: Seen = { discoveryHits: 0 }

let server: Server
let baseUrl: string
let previousNodeEnv: string | undefined
let previousMockBase: string | undefined

const PROFILE = {
  sub: '108374928174928374928',
  email: 'user@example.test',
  email_verified: true,
  name: 'Test User',
  picture: 'https://lh3.test/photo.jpg',
  locale: 'en',
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const json = (body: unknown, status = 200): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (req.url === '/.well-known/openid-configuration') {
      seen.discoveryHits += 1
      // Every endpoint points back at THIS server, which is what makes the exchange real. The
      // conformance suite next door points them at an https host it never fetches, because it is
      // asserting the redirect and not the exchange.
      //
      // `authorization_endpoint` stays https: the provider refuses a non-https one before building
      // the redirect (#192, open-redirect guard), and that guard is not what this file is testing.
      json({
        issuer: baseUrl,
        authorization_endpoint: 'https://accounts.google.test/o/oauth2/v2/auth',
        token_endpoint: `${baseUrl}/token`,
        userinfo_endpoint: `${baseUrl}/userinfo`,
        jwks_uri: `${baseUrl}/certs`,
      })
      return
    }

    if (req.url === '/token' && req.method === 'POST') {
      seen.tokenContentType = req.headers['content-type']
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        // Parsed the way a real token endpoint parses it. If the client sent JSON, or forgot the
        // content type, this yields nothing usable — which is the class of bug a `fetch` spy
        // asserting on `calls[1]` cannot reach.
        seen.tokenBody = new URLSearchParams(raw)
        json({
          access_token: 'ya29.sidecar-access',
          id_token: 'eyJ.sidecar.idtoken',
          refresh_token: '1//sidecar-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      })
      return
    }

    if (req.url === '/userinfo') {
      seen.userinfoAuth = req.headers.authorization
      json(PROFILE)
      return
    }

    res.writeHead(404).end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // Honored only for loopback and only under NODE_ENV=test — the package's own SSRF guard. Both
  // conditions are met deliberately.
  previousNodeEnv = process.env.NODE_ENV
  previousMockBase = process.env.MOCK_GOOGLE_OIDC_BASE_URL
  process.env.NODE_ENV = 'test'
  process.env.MOCK_GOOGLE_OIDC_BASE_URL = baseUrl
})

afterAll(async () => {
  // Both globals restored, not merely one — `rules/testing.md § 3` asks for independence from the
  // test, not from the runner's current isolation setting.
  if (previousMockBase === undefined) delete process.env.MOCK_GOOGLE_OIDC_BASE_URL
  else process.env.MOCK_GOOGLE_OIDC_BASE_URL = previousMockBase
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const TX = {
  state: 'tx-state-12345',
  pkceVerifier: 'verifier-43-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  createdAt: Date.now(),
  expiresAt: Date.now() + 600_000,
}

function callbackReq(query: string): IncomingMessage {
  return {
    url: `/api/auth/google/callback${query}`,
    headers: { host: 'myapp.test' },
  } as unknown as IncomingMessage
}

function provider() {
  return google({
    clientId: 'test-client-id.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-test-secret',
    redirectUri: 'https://myapp.test/api/auth/google/callback',
  })
}

describe('the success leg completes across a socket', () => {
  it('exchanges the code and maps the profile', async () => {
    const result = await provider().handleCallback(
      callbackReq(`?code=auth-code-xyz&state=${TX.state}`),
      TX,
    )

    expect(result.providerName).toBe('google')
    expect(result.profile.sub).toBe(PROFILE.sub)
    expect(result.profile.email).toBe(PROFILE.email)
    expect(result.rawTokens?.accessToken).toBe('ya29.sidecar-access')
    expect(result.rawTokens?.idToken).toBe('eyJ.sidecar.idtoken')
    expect(result.rawTokens?.refreshToken).toBe('1//sidecar-refresh')
  })

  it('sent a form body a real server can parse', () => {
    // The assertion the unit test cannot make: this is what came OFF the socket, after the server
    // decoded it — not what was handed to a `fetch` spy.
    expect(seen.tokenContentType).toMatch(/application\/x-www-form-urlencoded/)
    expect(seen.tokenBody?.get('grant_type')).toBe('authorization_code')
    expect(seen.tokenBody?.get('code')).toBe('auth-code-xyz')
    expect(seen.tokenBody?.get('code_verifier')).toBe(TX.pkceVerifier)
    expect(seen.tokenBody?.get('redirect_uri')).toBe('https://myapp.test/api/auth/google/callback')
  })

  it('carried the access token to userinfo as a bearer credential', () => {
    expect(seen.userinfoAuth).toBe('Bearer ya29.sidecar-access')
  })

  it('used the DISCOVERED endpoints, not configured ones', () => {
    // No endpoint is configured on the provider. Reaching the sidecar at all proves discovery ran
    // and its document decided where the exchange went.
    expect(seen.discoveryHits).toBeGreaterThan(0)
  })
})
