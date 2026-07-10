/**
 * @theokit/auth-google — public types.
 *
 * Per plan G11 ADR D9: per-provider profile type (not generic).
 * `sub` is OIDC subject — CASE-SENSITIVE (Wasp incident lesson).
 */

export interface GoogleProfile {
  /** OIDC subject identifier — case-sensitive, never lowercased. */
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
  locale?: string
}

export interface GoogleProviderOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  /**
   * Override OIDC discovery base URL. Defaults to `https://accounts.google.com`.
   * Per plan v1.1 EC-3: when `process.env.NODE_ENV === 'test'` AND
   * `process.env.MOCK_GOOGLE_OIDC_BASE_URL` is set, that env var takes
   * precedence over this option (test-only escape hatch). Production
   * builds (`NODE_ENV !== 'test'`) ignore the env var entirely.
   */
  oidcBaseUrl?: string
}
