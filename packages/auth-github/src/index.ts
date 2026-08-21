// @theokit/auth-github v0.1.0 — GitHub OAuth 2.0 provider for defineAuth.
//
// Per plan g11-auth-architecture-implementation T3.1 + Wasp blueprint Q1:
// - NO OIDC discovery — GitHub does not expose `.well-known/openid-configuration`.
// Endpoints are hardcoded (override via opts.* for GitHub Enterprise).
// - NO PKCE — GitHub OAuth 2.0 ignores PKCE params (RFC 7636 not implemented).
// CSRF defense via `state` only per RFC 6749 §10.12.
// - Conditional second fetch to /user/emails when scope includes `user:email`
// because GitHub's /user response returns `email: null` for users without a
// public email address (Wasp blueprint Q1 finding).
// - GitHubProfile.id is preserved as `number` (ADR D9 — Wasp incident lesson
// also applies: do not coerce types).
// - Userinfo `Authorization: token X` header (NOT `Bearer X`) per GitHub REST
// API docs.

import type { IncomingMessage } from 'node:http'
import type { AuthProvider, AuthResult, OAuthTransaction } from '@theokit/sdk/server/auth'
import type { GitHubProfile, GitHubProviderOptions } from './types.js'

export type { GitHubProfile, GitHubProviderOptions } from './types.js'

const DEFAULT_AUTHORIZE = 'https://github.com/login/oauth/authorize'
const DEFAULT_TOKEN = 'https://github.com/login/oauth/access_token'
const DEFAULT_USERINFO = 'https://api.github.com/user'
const DEFAULT_EMAILS = 'https://api.github.com/user/emails'
const DEFAULT_SCOPES: readonly string[] = ['read:user', 'user:email']

/**
 * Raised when GitHub answers, but not with an identity this provider can return.
 *
 * `code` names which step failed (`missing_login`, `emails_fetch_failed`, …) so a caller can branch
 * without matching on message text. It is deliberately distinct from a network failure: reaching
 * this error means the exchange completed and the response was unusable.
 */
export class GitHubAuthError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GitHubAuthError'
    this.code = code
  }
}

interface TokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
}

interface EmailEntry {
  email: string
  primary: boolean
  verified: boolean
}

/**
 * True when the request is a Web `Request` rather than Node's `IncomingMessage`.
 *
 * Duck-typed on `headers.get` instead of `instanceof Request`: the global is absent on some
 * runtimes and `instanceof` fails across realms, both of which would silently send a Web request
 * down the Node path and produce a nonsense URL rather than an error.
 */
function isWebRequest(req: IncomingMessage | Request): req is Request {
  return typeof (req as Request).headers?.get === 'function'
}

/**
 * The callback URL, from either request shape.
 *
 * A Web `Request` already carries an absolute URL. `IncomingMessage` carries a path plus a `host`
 * header, so an origin is synthesised — only the query string is read from the result, and the
 * scheme is never used.
 */
function parseCallbackUrl(req: IncomingMessage | Request): URL {
  if (isWebRequest(req)) return new URL(req.url)
  return new URL(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`)
}

function resolveScopes(opts: GitHubProviderOptions): readonly string[] {
  return opts.scopes ?? DEFAULT_SCOPES
}

/**
 * GitHub OAuth 2.0 provider for `defineAuth`.
 *
 * There is no OIDC discovery and no PKCE here, and neither is an omission: GitHub publishes no
 * `.well-known/openid-configuration`, and its OAuth 2.0 endpoint ignores PKCE parameters entirely
 * (RFC 7636 is not implemented). CSRF defence therefore rests on `state` alone, per RFC 6749 §10.12.
 *
 * When the granted scopes include `user:email`, resolving the profile costs a second request to
 * `/user/emails`, because `/user` reports `email: null` for a user without a public address. A
 * failure of that second request throws rather than yielding a null-email identity.
 */
export function github(opts: GitHubProviderOptions): Omit<
  AuthProvider<GitHubProfile, 'github'>,
  'handleCallback'
> & {
  /**
   * Exchange the callback for a profile.
   *
   * Accepts a Web `Request` as well as Node's `IncomingMessage`: the SDK's `AuthProvider` types this
   * parameter as the Node shape, and TheoKit's route handler hands the Web one (#68).
   */
  handleCallback(
    req: IncomingMessage | Request,
    tx: OAuthTransaction,
  ): Promise<AuthResult<GitHubProfile, 'github'>>
} {
  const scopes = resolveScopes(opts)
  const wantsEmail = scopes.includes('user:email')
  const authorizeEndpoint = opts.authorizationEndpoint ?? DEFAULT_AUTHORIZE
  const tokenEndpoint = opts.tokenEndpoint ?? DEFAULT_TOKEN
  const userinfoEndpoint = opts.userinfoEndpoint ?? DEFAULT_USERINFO
  const emailsEndpoint = opts.userEmailsEndpoint ?? DEFAULT_EMAILS

  return {
    name: 'github',

    createAuthorizationURL(tx: OAuthTransaction): Promise<URL> {
      const url = new URL(authorizeEndpoint)
      url.searchParams.set('client_id', opts.clientId)
      url.searchParams.set('redirect_uri', opts.redirectUri)
      url.searchParams.set('scope', scopes.join(' '))
      url.searchParams.set('state', tx.state)
      // GitHub allows response_type omission; include for RFC 6749 compliance
      url.searchParams.set('response_type', 'code')
      return Promise.resolve(url)
    },

    async handleCallback(
      req: IncomingMessage | Request,
      tx: OAuthTransaction,
    ): Promise<AuthResult<GitHubProfile, 'github'>> {
      const url = parseCallbackUrl(req)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (!code) {
        throw new GitHubAuthError('missing_code', 'OAuth callback missing code query param')
      }
      if (state !== tx.state) {
        throw new GitHubAuthError(
          'state_mismatch',
          'OAuth state query param does not match transaction state (CSRF guard)',
        )
      }

      // #183: behavior-preserving extraction into named helpers keeps this
      // method's cyclomatic complexity low. Each helper owns one fetch + its guards.
      const accessToken = await githubExchangeToken(code, opts, tokenEndpoint)
      const raw = await githubFetchUser(accessToken, userinfoEndpoint)
      const email = await githubResolveEmail(raw, wantsEmail, accessToken, emailsEndpoint)

      const profile: GitHubProfile = {
        id: raw.id,
        login: raw.login,
        name: raw.name ?? null,
        email,
        avatar_url: raw.avatar_url,
      }

      return {
        profile,
        providerName: 'github',
        rawTokens: { accessToken },
      }
    },
  }
}

/** Exchange the OAuth code for an access token (throws on failure). */
async function githubExchangeToken(
  code: string,
  opts: GitHubProviderOptions,
  tokenEndpoint: string,
): Promise<string> {
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  })
  const tokenRes = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  })
  if (!tokenRes.ok) {
    throw new GitHubAuthError(
      'token_exchange_failed',
      `GitHub token exchange failed: HTTP ${tokenRes.status}`,
    )
  }
  const tokens = (await tokenRes.json()) as TokenResponse
  if (!tokens.access_token) {
    throw new GitHubAuthError(
      'missing_access_token',
      'GitHub token response did not include access_token',
    )
  }
  return tokens.access_token
}

/** Fetch the GitHub user profile (note `Authorization: token X`). Throws on failure. */
async function githubFetchUser(
  accessToken: string,
  userinfoEndpoint: string,
): Promise<Partial<GitHubProfile> & { id: number; login: string }> {
  const userRes = await fetch(userinfoEndpoint, {
    headers: { authorization: `token ${accessToken}`, accept: 'application/vnd.github+json' },
  })
  if (!userRes.ok) {
    throw new GitHubAuthError(
      'userinfo_fetch_failed',
      `GitHub userinfo fetch failed: HTTP ${userRes.status}`,
    )
  }
  const raw = (await userRes.json()) as Partial<GitHubProfile>
  if (typeof raw.id !== 'number') {
    throw new GitHubAuthError('missing_id', 'GitHub userinfo response missing numeric id field')
  }
  if (!raw.login) {
    throw new GitHubAuthError('missing_login', 'GitHub userinfo response missing login field')
  }
  return raw as Partial<GitHubProfile> & { id: number; login: string }
}

/**
 * Resolve the email: `/user.email` when present; otherwise (when `user:email`
 * scope was granted) the primary/first verified email from `/user/emails`.
 * #203: a failed `/user/emails` fetch fails loud instead of yielding a null email.
 */
async function githubResolveEmail(
  raw: Partial<GitHubProfile>,
  wantsEmail: boolean,
  accessToken: string,
  emailsEndpoint: string,
): Promise<string | null> {
  let email = raw.email ?? null
  if (wantsEmail && !email) {
    const emailsRes = await fetch(emailsEndpoint, {
      headers: { authorization: `token ${accessToken}`, accept: 'application/vnd.github+json' },
    })
    if (!emailsRes.ok) {
      throw new GitHubAuthError(
        'emails_fetch_failed',
        `GitHub /user/emails fetch failed: HTTP ${emailsRes.status} ` +
          '(user:email scope was granted; refusing to return a null-email identity)',
      )
    }
    const entries = (await emailsRes.json()) as EmailEntry[]
    const primary = entries.find((e) => e.primary && e.verified)
    // email may still be null here when the user has NO verified email — a
    // legitimate, documented outcome, distinct from the fetch failure above.
    email = primary?.email ?? entries.find((e) => e.verified)?.email ?? null
  }
  return email
}
