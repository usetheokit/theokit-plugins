// @theokit/auth-google v0.1.0 — Google OAuth (OIDC) provider for defineAuth.
//
// Implements OIDC discovery + PKCE + authorization-code flow + userinfo fetch
// per RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), and OpenID Connect Core 1.0.
//
// Composes theokit/server/auth primitives — does NOT reinvent crypto.
//
// Per plan g11-auth-architecture-implementation T2.2 + ADR D9:
// - GoogleProfile.sub is OIDC subject — case-sensitive, never lowercased.
// - Per v1.1 EC-3: opts.oidcBaseUrl overrides default; in NODE_ENV=test
// MOCK_GOOGLE_OIDC_BASE_URL env var takes precedence over opts (sidecar
// OIDC mock unblock for Playwright tests). Production builds ignore env.

import type { IncomingMessage } from 'node:http'
import type { AuthProvider, AuthResult, OAuthTransaction } from '@theokit/sdk/server/auth'
import { discoverOidcProvider, pkceChallengeFromVerifier } from 'theokit/server/auth'
import type { GoogleProfile, GoogleProviderOptions } from './types.js'

export type { GoogleProfile, GoogleProviderOptions } from './types.js'

const DEFAULT_GOOGLE_OIDC_BASE = 'https://accounts.google.com'
const GOOGLE_SCOPES = 'openid profile email'

/**
 * Raised when the OIDC exchange completes but does not yield a usable identity.
 *
 * `code` names the failing step (`missing_pkce_verifier`, …) so callers branch on a value rather
 * than on message text.
 */
export class GoogleAuthError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GoogleAuthError'
    this.code = code
  }
}

interface TokenResponse {
  access_token?: string
  id_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
}

// #192: loopback hosts are exempt from the https requirement below. A loopback
// target can only reach the same machine, so it cannot exfiltrate credentials
// to an external attacker — which is what lets the test sidecar mock keep using
// http://localhost while every production OIDC URL stays https-only.
function isLoopbackHost(hostname: string): boolean {
  // `URL.hostname` KEEPS the brackets for IPv6 (`new URL("http://[::1]").hostname`
  // === "[::1]"), so match the bracketed form; the bare "::1" is accepted too for
  // defensiveness. URL parsing already lowercases the host and normalizes
  // decimal/octal/hex IPv4 (e.g. 2130706433, 0x7f.0.0.1) to dotted-quad, so the
  // 127.0.0.0/8 regex catches every loopback IPv4 spelling.
  // #F-sec-3: "0.0.0.0" (INADDR_ANY) is a wildcard BIND address, not a loopback
  // DESTINATION — a discovery doc pointing http://0.0.0.0:PORT is a plaintext
  // exfil vector, not a local mock. It is NOT exempt. (URL parsing normalizes
  // the short form http://0/ to hostname "0.0.0.0", so that spelling is rejected
  // by the same omission; IPv6 unspecified "[::]" was never in this set.)
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') {
    return true
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

// #192 SSRF guard: any URL we will fetch (the discovery base OR a discovered
// authorization/token/userinfo endpoint) MUST be https — loopback exempt. The
// token endpoint receives client_secret + auth code, so an attacker-controlled
// http endpoint would leak them in plaintext. NOTE: the finding's prescribed
// "discovered endpoint host == base host" check is deliberately NOT used —
// real Google discovery spans accounts.google.com / oauth2.googleapis.com /
// openidconnect.googleapis.com, so strict host-equality would break production.
// The https-except-loopback rule closes the plaintext-exfil vector without that
// breakage (supersedes finding #192 sub-fix (c); see CHANGELOG / changeset).
function assertSafeOidcUrl(rawUrl: string, context: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new GoogleAuthError(
      'insecure_oidc_url',
      `${context} "${rawUrl}" is not a valid absolute URL`,
    )
  }
  if (parsed.protocol === 'https:') return
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return
  throw new GoogleAuthError(
    'insecure_oidc_url',
    `${context} must use https (got "${parsed.protocol}//${parsed.hostname}"); ` +
      'only loopback hosts may use http.',
  )
}

function resolveOidcBaseUrl(opts: GoogleProviderOptions): string {
  // EC-3 + #192: the test-only env override is the SSRF entry point most at
  // risk — an attacker who flips NODE_ENV=test could otherwise redirect
  // discovery to their server. Honor it ONLY when it targets loopback: a
  // loopback override cannot exfiltrate to an external host even if NODE_ENV
  // leaks into prod. This replaces the impractical "build-time flag" (a
  // published JS lib has no portable build flag) with a restriction that
  // directly kills the vector (#192 sub-fix (a)).
  if (process.env.NODE_ENV === 'test' && process.env.MOCK_GOOGLE_OIDC_BASE_URL) {
    const envBase = process.env.MOCK_GOOGLE_OIDC_BASE_URL
    let parsed: URL
    try {
      parsed = new URL(envBase)
    } catch {
      throw new GoogleAuthError(
        'ssrf_env_override_non_loopback',
        `MOCK_GOOGLE_OIDC_BASE_URL "${envBase}" is not a valid URL`,
      )
    }
    if (!isLoopbackHost(parsed.hostname)) {
      throw new GoogleAuthError(
        'ssrf_env_override_non_loopback',
        `MOCK_GOOGLE_OIDC_BASE_URL must target a loopback host (got "${parsed.hostname}"); ` +
          'the test override cannot point at an external host (SSRF guard, #192).',
      )
    }
    return envBase
  }
  const base = opts.oidcBaseUrl ?? DEFAULT_GOOGLE_OIDC_BASE
  // #192 sub-fix (b): a consumer-supplied base must still be https (or loopback).
  assertSafeOidcUrl(base, 'oidcBaseUrl')
  return base
}

function parseCallbackUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? 'localhost'
  return new URL(`http://${host}${req.url ?? '/'}`)
}

/**
 * Google OAuth 2.0 / OIDC provider for `defineAuth`.
 *
 * Endpoints are discovered rather than hardcoded, and PKCE is mandatory: a transaction without a
 * `pkceVerifier` is rejected instead of silently downgrading to the weaker `state`-only flow. The
 * crypto primitives come from `theokit/server/auth`; nothing here reimplements them.
 *
 * `oidcBaseUrl` exists so a test can point discovery at a mock. The `MOCK_GOOGLE_OIDC_BASE_URL`
 * environment variable overrides it, but only when `NODE_ENV === 'test'` — a production build
 * ignores that variable entirely, so the escape hatch cannot be opened from the outside.
 */
export function google(opts: GoogleProviderOptions): AuthProvider<GoogleProfile, 'google'> {
  return {
    name: 'google',

    async createAuthorizationURL(tx: OAuthTransaction): Promise<URL> {
      if (!tx.pkceVerifier) {
        throw new GoogleAuthError(
          'missing_pkce_verifier',
          'OAuthTransaction must include pkceVerifier for Google (PKCE is mandatory per RFC 7636).',
        )
      }
      const baseUrl = resolveOidcBaseUrl(opts)
      const metadata = await discoverOidcProvider(baseUrl)
      // #192: a poisoned discovery doc could point the redirect target at an
      // attacker (open-redirect / phishing of state + client_id). Reject a
      // non-https authorization_endpoint before building the redirect URL.
      assertSafeOidcUrl(metadata.authorization_endpoint, 'discovered authorization_endpoint')
      const codeChallenge = await pkceChallengeFromVerifier(tx.pkceVerifier)

      const url = new URL(metadata.authorization_endpoint)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', opts.clientId)
      url.searchParams.set('redirect_uri', opts.redirectUri)
      url.searchParams.set('scope', GOOGLE_SCOPES)
      url.searchParams.set('state', tx.state)
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return url
    },

    async handleCallback(
      req: IncomingMessage,
      tx: OAuthTransaction,
    ): Promise<AuthResult<GoogleProfile, 'google'>> {
      const url = parseCallbackUrl(req)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (!code) {
        throw new GoogleAuthError('missing_code', 'OAuth callback URL missing code query param')
      }
      if (state !== tx.state) {
        throw new GoogleAuthError(
          'state_mismatch',
          'OAuth state query param does not match transaction state (CSRF guard)',
        )
      }
      if (!tx.pkceVerifier) {
        throw new GoogleAuthError(
          'missing_pkce_verifier',
          'Transaction missing pkceVerifier — Google requires PKCE',
        )
      }

      const baseUrl = resolveOidcBaseUrl(opts)
      const metadata = await discoverOidcProvider(baseUrl)
      // #192: validate the token endpoint BEFORE the client_secret-bearing POST
      // fires — a poisoned http token_endpoint would exfiltrate the secret +
      // auth code in plaintext.
      assertSafeOidcUrl(metadata.token_endpoint, 'discovered token_endpoint')

      // Token exchange
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: opts.redirectUri,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        code_verifier: tx.pkceVerifier,
      })
      const tokenRes = await fetch(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      })
      if (!tokenRes.ok) {
        throw new GoogleAuthError(
          'token_exchange_failed',
          `Google token exchange failed: HTTP ${tokenRes.status}`,
        )
      }
      const tokens = (await tokenRes.json()) as TokenResponse
      if (!tokens.access_token) {
        throw new GoogleAuthError(
          'missing_access_token',
          'Google token response did not include access_token',
        )
      }

      // Userinfo fetch
      if (!metadata.userinfo_endpoint) {
        throw new GoogleAuthError(
          'no_userinfo_endpoint',
          'OIDC discovery metadata lacks userinfo_endpoint — cannot fetch profile',
        )
      }
      // #192: validate the userinfo endpoint before sending the access token to
      // it — a poisoned http userinfo_endpoint would leak the bearer token.
      assertSafeOidcUrl(metadata.userinfo_endpoint, 'discovered userinfo_endpoint')
      const userRes = await fetch(metadata.userinfo_endpoint, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      })
      if (!userRes.ok) {
        throw new GoogleAuthError(
          'userinfo_fetch_failed',
          `Google userinfo fetch failed: HTTP ${userRes.status}`,
        )
      }
      const raw = (await userRes.json()) as Partial<GoogleProfile>
      if (!raw.sub) {
        throw new GoogleAuthError(
          'missing_sub',
          'Google userinfo response missing required sub field',
        )
      }
      if (!raw.email) {
        throw new GoogleAuthError(
          'missing_email',
          'Google userinfo response missing required email field',
        )
      }

      // Wasp incident lesson (ADR D9): preserve sub verbatim, no normalization
      const profile: GoogleProfile = {
        sub: raw.sub,
        email: raw.email,
        email_verified: raw.email_verified ?? false,
        name: raw.name,
        picture: raw.picture,
        locale: raw.locale,
      }

      return {
        profile,
        providerName: 'google',
        rawTokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
        },
      }
    },
  }
}
