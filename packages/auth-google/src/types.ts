// @theokit/auth-google — public types.
//
// Per plan G11 ADR D9: per-provider profile type (not generic).
// `sub` is OIDC subject — CASE-SENSITIVE (Wasp incident lesson).

/**
 * The Google identity as this provider hands it to `defineAuth`, taken from the OIDC userinfo
 * response.
 *
 * `sub` is the OIDC subject and is the only stable key here — `email` can change owner over the
 * life of a Google Workspace account. It is case-sensitive and must never be lowercased on the way
 * into storage, which is the shape of a real incident rather than a style preference (ADR D9).
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

/**
 * Options for {@link google}. Endpoints are not listed because they are not configured: they come
 * from OIDC discovery against `oidcBaseUrl`.
 */
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
