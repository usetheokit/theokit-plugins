/**
 * `auth-google`, driven by the orchestrator TheoKit actually uses.
 *
 * B-001's DoD names "the `AuthProvider` contract from `@theokit/sdk/server/auth`" as the surface
 * to test against. Measured, `AuthProvider` is an `export type` — the module's runtime exports
 * are `Auth`, `validateReturnTo` and five error classes. Nothing can be handed to a type,
 * so this suite targets `Auth.create` instead, and the DoD is corrected rather than satisfied
 * literally.
 *
 * Constructing the orchestrator is NOT the test. Probed directly against the installed sdk,
 * `Auth.create({ session, providers: [{ name: 'broken' }] })` returns the full five-method
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
import { Auth } from '@theokit/sdk/server/auth'
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
  return Auth.create<Session>({
    // `createSessionManager`, not `createSessionManagerWeb`. The Web variant is WHATWG-shaped
    // (Request/Headers) while the sdk's `SessionManager` is Node-shaped
    // (IncomingMessage/ServerResponse), so the two do not interchange — tsc caught the swap. The
    // session is not what this suite tests; it is the argument `Auth.create` requires.
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

  it('completes the round trip: the cookie startSignIn sets is one finishSignIn can read', async () => {
    // This was an `it.fails` — a canary, passing while the body threw and turning red the moment
    // it stopped. It turned red, which is the outcome it was written for.
    //
    // The defect: `startSignIn` wrote `theo_oauth_tx=...` while the transaction store read
    // `__Host-theo_oauth_tx`. The cookie was never found, so EVERY OAuth sign-in failed at the
    // callback with AuthCallbackError — in 2.18.0 and still in 4.53.1, so it survived a major.
    //
    // Filed as B-019, fixed upstream in usetheokit/theokit-sdk#377, shipped in
    // `@theokit/sdk@4.54.0`. The cookie name is now an exported const used at the write site,
    // so there is one name rather than two.
    //
    // It stays a round trip rather than becoming an assertion about a header: a conformance
    // suite that stopped at the 302 would certify half a journey, which is the failure mode this
    // file's own docstring argues against. The `await` below IS the assertion — it throws if the
    // callback cannot find what sign-in wrote.
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

    const started = await orchestrator.startSignIn('roundtrip', incomingRequest('/auth/roundtrip'))
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
  })
})

/**
 * Why this suite breaks on an sdk major bump, and the packages do not.
 *
 * Measured 2026-08-24 against both majors installed here: `defineAuth` is a function in sdk 2.18.0
 * and `undefined` in 4.53.1, where the orchestrator is the `Auth` class instead. A token-level grep
 * finds the name in both — importing the module is what discriminates.
 *
 * But **no package imports it.** `auth-github`, `auth-google` and `auth-magic-link` take
 * `AuthProvider`, `AuthResult` and `OAuthTransaction` as `import type`, and all three types exist in
 * both majors. `plugin-copilot` takes one type from the root barrel. The sole caller of `defineAuth`
 * in this repository is this file — because a **type contract** cannot be handed to anything, so a
 * runtime seam is the only thing a conformance test can drive.
 *
 * The consequence for a consumer is worth stating, because it is the one real cost of the pin: the
 * packages declare `^2.18.0` as a PEER range, so somebody already on sdk 4 hits a **peer conflict**
 * even though their type contract would be satisfied by it. That is a product decision about a
 * published range, not a defect.
 *
 * So: an out-of-range sdk should break this file, and it should say why. Before this assertion it
 * failed with a bare `TypeError: defineAuth is not a function`, which cost three measurements to
 * explain — the last of which refuted the premise it was filed under.
 */
describe('the sdk major this suite assumes', () => {
  it('is within the range the packages themselves declare', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    /**
     * Find a package's own manifest, the way a consumer's resolver would.
     *
     * Two things this deliberately does not do. It does not ask for `<pkg>/package.json`: neither
     * package lists that in `exports`, so it throws `ERR_PACKAGE_PATH_NOT_EXPORTED` — correctly, a
     * manifest is not public surface. And it does not use `createRequire().resolve`: these packages
     * are ESM-only, their `.` entry defines no `require` condition, and asking for one answers
     * "No exports main defined" — a resolution failure that says nothing about the package.
     *
     * `import.meta.resolve` uses the `import` condition, which is the one that exists.
     */
    const manifestOf = (specifier: string): Record<string, unknown> => {
      let dir = dirname(fileURLToPath(import.meta.resolve(specifier)))
      for (let depth = 0; depth < 8; depth += 1) {
        try {
          return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<
            string,
            unknown
          >
        } catch {
          dir = dirname(dir)
        }
      }
      throw new Error(`no package.json found above the entry point of ${specifier}`)
    }

    // Both sides read from disk. A hardcoded major would restate the manifest in a second place
    // that can drift from it — the shape two other gates in this repository were fixed for.
    const pkg = manifestOf('@theokit/auth-github') as {
      peerDependencies?: Record<string, string>
    }
    const declared = pkg.peerDependencies?.['@theokit/sdk']
    expect(declared, '@theokit/auth-github stopped declaring an sdk peer range').toBeDefined()

    const sdk = manifestOf('@theokit/sdk/server/auth') as { version: string }

    const declaredMajor = Number(/(\d+)/.exec(declared!)?.[1])
    const resolvedMajor = Number(sdk.version.split('.')[0])

    expect(
      resolvedMajor,
      `@theokit/sdk resolved to ${sdk.version}, outside the ${declared} that ` +
        '@theokit/auth-github declares. `defineAuth` is a function in sdk 2.x and absent in 4.x, ' +
        'where the orchestrator is the `Auth` class — so this suite cannot run. The PACKAGES are ' +
        'unaffected: they import types only, and those types exist in both majors. Either pin the ' +
        'sdk back, or migrate this suite to `Auth` and update this assertion deliberately.',
    ).toBe(declaredMajor)
  })

  it('reads the expectation from the manifest rather than a constant', () => {
    // The property that makes the assertion above a check instead of a copy: change the declared
    // range and the expectation follows. A hardcoded `toBe(2)` would pass this file and fail the
    // day the decision changes, for the wrong reason.
    const parse = (range: string): number => Number(/(\d+)/.exec(range)?.[1])

    expect(parse('^2.18.0')).toBe(2)
    expect(parse('>=4.0.0 <5.0.0')).toBe(4)
    expect(parse('^11.2.0')).toBe(11)
  })
})
