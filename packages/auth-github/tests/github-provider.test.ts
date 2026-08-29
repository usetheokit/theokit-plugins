/**
 * @theokit/auth-github — T3.1 unit tests.
 *
 * Covers plan TDD checklist:
 *   - test_github_authorization_url_pkce_optional   (opt-in per #196; was a no-PKCE invariant)
 *   - test_github_handle_callback_uses_token_auth_header (NOT Bearer)
 *   - test_github_handle_callback_fetches_emails_when_scope_includes
 *   - test_github_profile_id_is_number_not_string      (type invariant)
 *   - test_github_callback_works_without_user_email_scope
 *   - test_github_callback_throws_on_403_rate_limit    (error mapping)
 *   - test_github_callback_throws_on_state_mismatch    (CSRF guard — added)
 *   - test_github_state_param_present_in_authorize_url (RFC 6749 §10.12)
 */

import type { IncomingMessage } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { github } from '../src/index.js'
import type { OAuthTransaction } from '@theokit/sdk/server/auth'

const OPTS = {
  clientId: 'Iv1.test_github_client',
  clientSecret: 'ghsec_test_secret',
  redirectUri: 'https://myapp.test/api/auth/github/callback',
}

const TX: OAuthTransaction = {
  state: 'tx-state-abc',
  createdAt: Date.now(),
  expiresAt: Date.now() + 600_000,
}

function mockReq(query: string): IncomingMessage {
  return {
    url: `/api/auth/github/callback${query}`,
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
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('github() — createAuthorizationURL', () => {
  it('omits PKCE params when the transaction carries no verifier', async () => {
    // Not because GitHub cannot take them — it can, since July 2025 — but because the caller did
    // not ask. `newTransaction(withPkce)` is the consumer's choice, and a provider that invented a
    // verifier would be deciding a security posture on their behalf.
    const provider = github(OPTS)
    const url = await provider.createAuthorizationURL(TX)

    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('code_challenge_method')).toBe(false)
  })

  /**
   * This case replaces one asserting the opposite — `test_github_authorization_url_no_pkce`, whose
   * name called it a "D9 invariant". It was correct when written: GitHub's OAuth 2.0 endpoint
   * ignored RFC 7636 entirely, so sending a challenge bought nothing.
   *
   * That changed in July 2025. Measured against the live endpoint rather than read from a
   * changelog — sending `code_challenge_method=plain` returns:
   *
   *   "When utilizing PKCE (RFC 7636), supply both a code_challenge_method and a code_challenge.
   *    The code_challenge_method is expected to be 'S256'. (code_challenge_method 'plain' is not
   *    supported.)"
   *
   * A provider that ignored the parameters would have rendered the consent screen. It parses them.
   *
   * Additive on purpose, and this is where it differs from `auth-google`: there PKCE is mandatory
   * and a transaction without a verifier is REJECTED, because Google requires it. GitHub does not,
   * so demanding one here would break every consumer calling `newTransaction(false)` for a
   * defence-in-depth gain. Opting in is the consumer's call (usetheokit/theokit-plugins#196).
   */
  it('sends an S256 challenge derived from the verifier when the transaction carries one', async () => {
    const verifier = 'a'.repeat(43)
    const provider = github(OPTS)
    const url = await provider.createAuthorizationURL({ ...TX, pkceVerifier: verifier })

    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    const challenge = url.searchParams.get('code_challenge')
    expect(challenge).toBeTruthy()
    // The challenge must be the S256 of THAT verifier, not merely present: a provider sending a
    // well-formed challenge unrelated to the verifier would pass a presence check and fail every
    // real exchange.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const expected = Buffer.from(new Uint8Array(digest))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(challenge).toBe(expected)
  })

  it('includes state param (RFC 6749 §10.12 CSRF defense)', async () => {
    const provider = github(OPTS)
    const url = await provider.createAuthorizationURL(TX)
    expect(url.searchParams.get('state')).toBe(TX.state)
  })

  it('uses GitHub authorize endpoint + default scope read:user user:email', async () => {
    const provider = github(OPTS)
    const url = await provider.createAuthorizationURL(TX)
    expect(url.toString().startsWith('https://github.com/login/oauth/authorize')).toBe(true)
    expect(url.searchParams.get('scope')).toBe('read:user user:email')
    expect(url.searchParams.get('client_id')).toBe(OPTS.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(OPTS.redirectUri)
  })

  it('does NOT call fetch (no discovery needed)', async () => {
    const provider = github(OPTS)
    await provider.createAuthorizationURL(TX)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('github() — handleCallback', () => {
  it('sends code_verifier on the token exchange when the transaction carries one', async () => {
    // The half that actually protects. A challenge on the authorization call with no verifier on
    // the exchange is theatre: GitHub has nothing to compare against, and an intercepted code is
    // as usable as before.
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_test_access', scope: 'read:user' }))
      .mockResolvedValueOnce(jsonResponse({ id: 1, login: 'o', name: 'O', email: 'o@github.test' }))

    const verifier = 'b'.repeat(43)
    const provider = github(OPTS)
    await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), {
      ...TX,
      pkceVerifier: verifier,
    })

    const body = new URLSearchParams((fetchSpy.mock.calls[0]![1] as { body: string }).body)
    expect(body.get('code_verifier')).toBe(verifier)
  })

  it('omits code_verifier when the transaction carries none, so existing callers are untouched', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_test_access', scope: 'read:user' }))
      .mockResolvedValueOnce(jsonResponse({ id: 1, login: 'o', name: 'O', email: 'o@github.test' }))

    const provider = github(OPTS)
    await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)

    const body = new URLSearchParams((fetchSpy.mock.calls[0]![1] as { body: string }).body)
    expect(body.has('code_verifier')).toBe(false)
  })

  it('uses Authorization: token (NOT Bearer) for userinfo fetch', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_test_access', scope: 'read:user' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 12345,
          login: 'octocat',
          name: 'Octo Cat',
          email: 'octocat@github.test',
          avatar_url: 'https://github.test/octocat.png',
        }),
      )

    const provider = github(OPTS)
    await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)

    const userinfoCall = fetchSpy.mock.calls[1]!
    expect(userinfoCall[0]).toBe('https://api.github.com/user')
    const headers = (userinfoCall[1] as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('token gho_test_access')
    expect(headers.authorization).not.toMatch(/^Bearer/i)
  })

  it('fetches /user/emails ONLY when scope includes user:email', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_t', scope: 'read:user,user:email' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 1, login: 'u', name: null, email: null, avatar_url: 'x' }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { email: 'secondary@test.com', primary: false, verified: true },
          { email: 'primary@test.com', primary: true, verified: true },
        ]),
      )

    const provider = github(OPTS)
    const result = await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy.mock.calls[2]![0]).toBe('https://api.github.com/user/emails')
    expect(result.profile.email).toBe('primary@test.com')
  })

  it('test_github_emails_failure_is_surfaced', async () => {
    // #203: user:email scope granted + /user.email null → emails fetch is
    // attempted; a non-ok emails response must NOT silently yield a null-email
    // identity — it must surface as a typed error so the caller decides.
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_t', scope: 'read:user,user:email' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 7, login: 'u', name: null, email: null, avatar_url: 'x' }),
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'API rate limit exceeded' }, { status: 403 }))

    const provider = github(OPTS)
    await expect(
      provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX),
    ).rejects.toMatchObject({ code: 'emails_fetch_failed' })
  })

  it('test_github_emails_legitimately_empty_stays_null', async () => {
    // #203 distinction: the emails endpoint SUCCEEDS but the user has no
    // verified email → email is legitimately null and the callback succeeds.
    // This must stay distinct from a fetch failure (which throws above).
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_t', scope: 'read:user,user:email' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 8, login: 'v', name: null, email: null, avatar_url: 'x' }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ email: 'unverified@test.com', primary: true, verified: false }]),
      )

    const provider = github(OPTS)
    const result = await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)
    expect(result.profile.email).toBeNull()
  })

  it('does NOT fetch /user/emails when scope omits user:email', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_t', scope: 'read:user' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 99,
          login: 'noscope',
          name: 'No Scope',
          email: null,
          avatar_url: 'y',
        }),
      )

    const provider = github({ ...OPTS, scopes: ['read:user'] })
    const result = await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result.profile.email).toBeNull()
  })

  it('preserves id as number, NEVER string (type invariant)', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_t', scope: 'read:user' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 67890,
          login: 'numuser',
          name: 'Num User',
          email: 'n@n.test',
          avatar_url: 'z',
        }),
      )

    const provider = github({ ...OPTS, scopes: ['read:user'] })
    const result = await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)

    expect(typeof result.profile.id).toBe('number')
    expect(result.profile.id).toBe(67890)
  })

  it('rejects state mismatch (CSRF defense)', async () => {
    const provider = github(OPTS)
    await expect(
      provider.handleCallback(mockReq('?code=c&state=tampered'), TX),
    ).rejects.toMatchObject({ code: 'state_mismatch' })
  })

  it('throws on 403 (rate-limit) userinfo response', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_t', scope: 'read:user' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'API rate limit exceeded' }, { status: 403 }))

    const provider = github({ ...OPTS, scopes: ['read:user'] })
    await expect(
      provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX),
    ).rejects.toMatchObject({ code: 'userinfo_fetch_failed' })
  })

  it('token exchange POSTs Accept: application/json (GitHub default is form-encoded — defense in depth)', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_t', scope: 'read:user' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 1, login: 'u', name: null, email: 'u@u.test', avatar_url: 'x' }),
      )

    const provider = github({ ...OPTS, scopes: ['read:user'] })
    await provider.handleCallback(mockReq(`?code=c&state=${TX.state}`), TX)

    const tokenCall = fetchSpy.mock.calls[0]!
    expect(tokenCall[0]).toBe('https://github.com/login/oauth/access_token')
    const headers = (tokenCall[1] as RequestInit).headers as Record<string, string>
    expect(headers.accept).toBe('application/json')
  })
})

describe('github() — accepts a Web Request', () => {
  // TheoKit's route handler hands a Web `Request`; the SDK's AuthProvider interface types this
  // parameter as Node's `IncomingMessage`. A provider that only understands the Node shape cannot
  // be wired into a TheoKit route at all (#68), so both are accepted at runtime.
  it('reads code and state from a Web Request exactly as from an IncomingMessage', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_tok', token_type: 'bearer' }))
      .mockResolvedValueOnce(jsonResponse({ id: 42, login: 'octocat', email: 'octo@github.test' }))

    const request = new Request(
      `https://myapp.test/api/auth/github/callback?code=c&state=${TX.state}`,
    )
    const result = await github(OPTS).handleCallback(request, TX)

    expect(result.profile.id).toBe(42)
    expect(result.profile.login).toBe('octocat')
  })

  it('rejects a Web Request whose state does not match the transaction', async () => {
    const request = new Request('https://myapp.test/api/auth/github/callback?code=c&state=forged')
    await expect(github(OPTS).handleCallback(request, TX)).rejects.toThrow(/state/i)
  })
})
