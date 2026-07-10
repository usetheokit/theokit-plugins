/**
 * @theokit/auth-google — T2.2 unit tests.
 *
 * Covers TDD checklist from plan g11-auth-architecture-implementation T2.2:
 *   - test_google_authorization_url_includes_pkce_and_state
 *   - test_google_authorization_url_calls_oidc_discovery
 *   - test_google_handle_callback_exchanges_code_for_tokens
 *   - test_google_handle_callback_returns_profile_with_case_sensitive_sub  (Wasp lesson regression)
 *   - test_google_handle_callback_throws_on_401_token_exchange
 *   - test_google_handle_callback_throws_on_missing_sub_in_userinfo
 *   - test_google_respects_oidc_base_url_opts_override                     (v1.1 EC-3)
 *   - test_google_respects_mock_env_in_test_mode_only                      (v1.1 EC-3)
 */

import type { IncomingMessage } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOidcCache } from 'theokit/server/auth'
import { google } from '../src/index.js'
import type { OAuthTransaction } from '@theokit/sdk/server/auth'

const MOCK_BASE = 'https://accounts.example-google.test'
const DISCOVERY_DOC = {
  issuer: MOCK_BASE,
  authorization_endpoint: `${MOCK_BASE}/o/oauth2/v2/auth`,
  token_endpoint: `${MOCK_BASE}/token`,
  userinfo_endpoint: `${MOCK_BASE}/v1/userinfo`,
  jwks_uri: `${MOCK_BASE}/jwks`,
}

const OPTS = {
  clientId: 'test-client-id.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-test-secret',
  redirectUri: 'https://myapp.test/api/auth/google/callback',
  oidcBaseUrl: MOCK_BASE,
}

const TX: OAuthTransaction = {
  state: 'tx-state-12345',
  pkceVerifier: 'verifier-43-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  createdAt: Date.now(),
  expiresAt: Date.now() + 600_000,
}

function mockReq(callbackQuery: string): IncomingMessage {
  return {
    url: `/api/auth/google/callback${callbackQuery}`,
    headers: { host: 'myapp.test' },
  } as unknown as IncomingMessage
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    statusText: init.statusText,
  })
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  clearOidcCache()
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.MOCK_GOOGLE_OIDC_BASE_URL
})

describe('google() — createAuthorizationURL', () => {
  it('includes PKCE challenge + state + Google scopes', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(DISCOVERY_DOC))
    const provider = google(OPTS)
    const url = await provider.createAuthorizationURL(TX)

    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe(OPTS.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(OPTS.redirectUri)
    expect(url.searchParams.get('scope')).toBe('openid profile email')
    expect(url.searchParams.get('state')).toBe(TX.state)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.toString().startsWith(DISCOVERY_DOC.authorization_endpoint)).toBe(true)
  })

  it('calls OIDC discovery against the configured base URL', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(DISCOVERY_DOC))
    const provider = google(OPTS)
    await provider.createAuthorizationURL(TX)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledWith = fetchSpy.mock.calls[0]![0] as string | URL
    expect(String(calledWith)).toContain('/.well-known/openid-configuration')
    expect(String(calledWith)).toContain(MOCK_BASE)
  })
})

describe('google() — handleCallback', () => {
  it('exchanges code for tokens then fetches userinfo', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(DISCOVERY_DOC))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'ya29.test-access',
          id_token: 'eyJ.test.idtoken',
          refresh_token: '1//test-refresh',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sub: '108374928174928374928',
          email: 'user@example.com',
          email_verified: true,
          name: 'Test User',
          picture: 'https://lh3.test/photo.jpg',
          locale: 'en',
        }),
      )

    const provider = google(OPTS)
    const result = await provider.handleCallback(
      mockReq(`?code=auth-code-xyz&state=${TX.state}`),
      TX,
    )

    expect(result.providerName).toBe('google')
    expect(result.profile.sub).toBe('108374928174928374928')
    expect(result.profile.email).toBe('user@example.com')
    expect(result.rawTokens?.accessToken).toBe('ya29.test-access')
    expect(result.rawTokens?.idToken).toBe('eyJ.test.idtoken')
    expect(result.rawTokens?.refreshToken).toBe('1//test-refresh')

    // Token endpoint POST shape
    const tokenCall = fetchSpy.mock.calls[1] as [string | URL, RequestInit]
    expect(tokenCall[0]).toBe(DISCOVERY_DOC.token_endpoint)
    expect(tokenCall[1].method).toBe('POST')
    const tokenBody = new URLSearchParams(tokenCall[1].body as string)
    expect(tokenBody.get('grant_type')).toBe('authorization_code')
    expect(tokenBody.get('code')).toBe('auth-code-xyz')
    expect(tokenBody.get('code_verifier')).toBe(TX.pkceVerifier)
    expect(tokenBody.get('client_secret')).toBe(OPTS.clientSecret)
  })

  it('preserves case-sensitive sub field (Wasp incident lesson regression)', async () => {
    const caseSensitiveSub = 'AbCdEf1234567890XYZ'
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(DISCOVERY_DOC))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tk' }))
      .mockResolvedValueOnce(
        jsonResponse({
          sub: caseSensitiveSub,
          email: 'x@example.com',
          email_verified: false,
        }),
      )

    const provider = google(OPTS)
    const result = await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)

    expect(result.profile.sub).toBe(caseSensitiveSub)
    expect(result.profile.sub).not.toBe(caseSensitiveSub.toLowerCase())
  })

  it('throws AuthCallbackError on 401 token exchange', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(DISCOVERY_DOC))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'invalid_grant' }, { status: 401, statusText: 'Unauthorized' }),
      )

    const provider = google(OPTS)
    await expect(
      provider.handleCallback(mockReq(`?code=bad&state=${TX.state}`), TX),
    ).rejects.toMatchObject({
      code: 'token_exchange_failed',
    })
  })

  it('throws when userinfo response lacks sub', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(DISCOVERY_DOC))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tk' }))
      .mockResolvedValueOnce(jsonResponse({ email: 'no-sub@example.com', email_verified: true }))

    const provider = google(OPTS)
    await expect(
      provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX),
    ).rejects.toMatchObject({
      code: 'missing_sub',
    })
  })

  it('rejects state mismatch (CSRF defense)', async () => {
    const provider = google(OPTS)
    await expect(
      provider.handleCallback(mockReq('?code=c&state=tampered'), TX),
    ).rejects.toMatchObject({
      code: 'state_mismatch',
    })
  })
})

describe('v1.1 EC-3 — oidcBaseUrl + env override', () => {
  it('opts.oidcBaseUrl overrides the default Google issuer', async () => {
    const sidecar = 'http://localhost:9999'
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ...DISCOVERY_DOC,
        issuer: sidecar,
        authorization_endpoint: `${sidecar}/o/oauth2/v2/auth`,
      }),
    )
    const provider = google({ ...OPTS, oidcBaseUrl: sidecar })
    await provider.createAuthorizationURL(TX)

    expect(String(fetchSpy.mock.calls[0]![0])).toContain(sidecar)
  })

  it('MOCK_GOOGLE_OIDC_BASE_URL env honored in NODE_ENV=test only', async () => {
    expect(process.env.NODE_ENV).toBe('test') // vitest sets this
    process.env.MOCK_GOOGLE_OIDC_BASE_URL = 'http://localhost:8888'
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ...DISCOVERY_DOC,
        issuer: 'http://localhost:8888',
        authorization_endpoint: 'http://localhost:8888/o/oauth2/v2/auth',
      }),
    )
    // Note: opts.oidcBaseUrl is set to the public mock — env should win in test mode
    const provider = google({ ...OPTS, oidcBaseUrl: MOCK_BASE })
    await provider.createAuthorizationURL(TX)

    expect(String(fetchSpy.mock.calls[0]![0])).toContain('localhost:8888')
    expect(String(fetchSpy.mock.calls[0]![0])).not.toContain(MOCK_BASE)
  })

  it("MOCK_GOOGLE_OIDC_BASE_URL ignored when NODE_ENV !== 'test'", async () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.MOCK_GOOGLE_OIDC_BASE_URL = 'http://localhost:8888'
    fetchSpy.mockResolvedValueOnce(jsonResponse(DISCOVERY_DOC))

    try {
      const provider = google({ ...OPTS, oidcBaseUrl: MOCK_BASE })
      await provider.createAuthorizationURL(TX)
      expect(String(fetchSpy.mock.calls[0]![0])).toContain(MOCK_BASE)
      expect(String(fetchSpy.mock.calls[0]![0])).not.toContain('localhost:8888')
    } finally {
      process.env.NODE_ENV = original
    }
  })
})

describe('#192 — OIDC base-URL SSRF hardening', () => {
  // The credential-exfil threat: an attacker-controlled OIDC base (via a custom
  // oidcBaseUrl, the test env override leaking to prod, or a poisoned discovery
  // doc) can point token_endpoint at their server, capturing client_secret +
  // auth code. Guard: every URL we fetch must be https — loopback exempt (a
  // loopback target cannot reach an external attacker; this is what lets the
  // localhost sidecar mock keep using http). NOTE: the finding's prescribed
  // "discovered endpoint host == base host" check is intentionally NOT used —
  // real Google discovery spans accounts.google.com / oauth2.googleapis.com /
  // openidconnect.googleapis.com, so host-equality would break production. The
  // https-except-loopback rule closes the plaintext-exfil vector without that
  // breakage. See CHANGELOG / changeset (supersedes finding #192 sub-fix (c)).

  it('test_opts_oidc_base_url_rejects_non_https_external', async () => {
    const provider = google({ ...OPTS, oidcBaseUrl: 'http://evil.attacker.test' })
    await expect(provider.createAuthorizationURL(TX)).rejects.toMatchObject({
      code: 'insecure_oidc_url',
    })
    // Rejected before any network call — no discovery against the attacker host.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('test_env_override_rejected_when_host_not_loopback', async () => {
    expect(process.env.NODE_ENV).toBe('test') // vitest sets this
    process.env.MOCK_GOOGLE_OIDC_BASE_URL = 'https://attacker.test'
    const provider = google({ ...OPTS, oidcBaseUrl: MOCK_BASE })
    await expect(provider.createAuthorizationURL(TX)).rejects.toMatchObject({
      code: 'ssrf_env_override_non_loopback',
    })
    // Even with NODE_ENV=test, a non-loopback env override cannot redirect the
    // flow to an external host (defense-in-depth if NODE_ENV leaks to prod).
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('test_discovered_authorization_endpoint_must_be_https', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ...DISCOVERY_DOC,
        authorization_endpoint: 'http://attacker.test/o/oauth2/v2/auth',
      }),
    )
    const provider = google(OPTS)
    await expect(provider.createAuthorizationURL(TX)).rejects.toMatchObject({
      code: 'insecure_oidc_url',
    })
    // Discovery ran (1 call) but the poisoned redirect target is rejected.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('test_discovered_token_endpoint_must_be_https', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ...DISCOVERY_DOC,
        token_endpoint: 'http://attacker.test/token',
      }),
    )
    const provider = google(OPTS)
    await expect(
      provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX),
    ).rejects.toMatchObject({ code: 'insecure_oidc_url' })
    // The client_secret-bearing POST must NOT fire against the attacker host:
    // only discovery (call 1) happened, no token exchange (call 2).
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('test_0_0_0_0_endpoint_rejected', async () => {
    // F-sec-3: 0.0.0.0 is the wildcard/INADDR_ANY bind address, NOT a loopback
    // destination. A poisoned discovery doc pointing token_endpoint at
    // http://0.0.0.0:PORT must be rejected as plaintext, not exempted.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ...DISCOVERY_DOC,
        token_endpoint: 'http://0.0.0.0:8080/token',
      }),
    )
    const provider = google(OPTS)
    await expect(
      provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX),
    ).rejects.toMatchObject({ code: 'insecure_oidc_url' })
    // client_secret-bearing POST must NOT fire: only discovery (call 1) happened.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('test_0_endpoint_normalized_to_0_0_0_0_rejected', async () => {
    // URL parsing normalizes http://0/ → hostname "0.0.0.0", so the short form
    // routes through the same (now-rejected) path. Belt-and-suspenders vector.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ...DISCOVERY_DOC,
        token_endpoint: 'http://0:8080/token',
      }),
    )
    const provider = google(OPTS)
    await expect(
      provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX),
    ).rejects.toMatchObject({ code: 'insecure_oidc_url' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('test_discovered_userinfo_endpoint_must_be_https', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          ...DISCOVERY_DOC,
          userinfo_endpoint: 'http://attacker.test/userinfo',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: 'ya29.tk' }))
    const provider = google(OPTS)
    await expect(
      provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX),
    ).rejects.toMatchObject({ code: 'insecure_oidc_url' })
    // Discovery (1) + token exchange (2) ran; the userinfo fetch is blocked.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('test_opts_oidc_base_url_rejects_malformed', async () => {
    const provider = google({ ...OPTS, oidcBaseUrl: 'not-a-url' })
    await expect(provider.createAuthorizationURL(TX)).rejects.toMatchObject({
      code: 'insecure_oidc_url',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('test_env_override_rejects_malformed', async () => {
    process.env.MOCK_GOOGLE_OIDC_BASE_URL = '::::not-a-url::::'
    const provider = google({ ...OPTS, oidcBaseUrl: MOCK_BASE })
    await expect(provider.createAuthorizationURL(TX)).rejects.toMatchObject({
      code: 'ssrf_env_override_non_loopback',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('test_ipv4_loopback_spellings_allowed', async () => {
    // URL parsing normalizes decimal/hex/octal IPv4 to dotted-quad loopback.
    const sidecar = 'http://2130706433:7777' // == 127.0.0.1
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ...DISCOVERY_DOC,
        issuer: sidecar,
        authorization_endpoint: `${sidecar}/o/oauth2/v2/auth`,
      }),
    )
    const provider = google({ ...OPTS, oidcBaseUrl: sidecar })
    await expect(provider.createAuthorizationURL(TX)).resolves.toBeInstanceOf(URL)
  })

  it('test_ipv6_loopback_http_allowed', async () => {
    const sidecar = 'http://[::1]:7777'
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ...DISCOVERY_DOC,
        issuer: sidecar,
        authorization_endpoint: `${sidecar}/o/oauth2/v2/auth`,
      }),
    )
    const provider = google({ ...OPTS, oidcBaseUrl: sidecar })
    await expect(provider.createAuthorizationURL(TX)).resolves.toBeInstanceOf(URL)
  })

  it('test_loopback_http_endpoints_allowed_no_over_blocking', async () => {
    // Positive: a localhost sidecar serving http endpoints must still work —
    // the https rule must not over-block loopback (guards the carve-out).
    const sidecar = 'http://localhost:7777'
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          issuer: sidecar,
          authorization_endpoint: `${sidecar}/o/oauth2/v2/auth`,
          token_endpoint: `${sidecar}/token`,
          userinfo_endpoint: `${sidecar}/v1/userinfo`,
          jwks_uri: `${sidecar}/jwks`,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: 'ya29.tk' }))
      .mockResolvedValueOnce(
        jsonResponse({ sub: 'S123', email: 'u@example.com', email_verified: true }),
      )
    const provider = google({ ...OPTS, oidcBaseUrl: sidecar })
    const result = await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)
    expect(result.profile.sub).toBe('S123')
  })
})
