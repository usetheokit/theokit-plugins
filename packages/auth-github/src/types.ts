// @theokit/auth-github — public types.
//
// Per plan G11 ADR D9: per-provider profile type.
// - `id` is numeric (GitHub user IDs are bigints exposed as JSON numbers).
// Preserve as `number`, NOT string.
// - `email` may be undefined when the granted scope omits `user:email` AND
// the user has no public email on their profile.

/**
 * The GitHub user as this provider hands it to `defineAuth`.
 *
 * `id` stays a `number`: GitHub user ids are bigints exposed as JSON numbers, and coercing them to
 * string here would make the stored identity disagree with every other GitHub API response (ADR D9).
 *
 * `email` is nullable even on success. GitHub returns `email: null` for a user with no public email,
 * and the `user:email` scope is what lets the provider fall back to `/user/emails`; without that
 * scope a verified address may exist and still be unreachable.
 */
export interface GitHubProfile {
  id: number
  login: string
  name?: string | null
  email?: string | null
  avatar_url?: string
}

/**
 * Options for {@link github}. The three credentials are required; every endpoint is overridable so
 * the same provider drives GitHub Enterprise, which serves them from a different host.
 */
export interface GitHubProviderOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Defaults to `['read:user', 'user:email']`. */
  scopes?: readonly string[]
  /** Override authorization endpoint (default https://github.com/login/oauth/authorize). */
  authorizationEndpoint?: string
  /** Override token endpoint (default https://github.com/login/oauth/access_token). */
  tokenEndpoint?: string
  /** Override userinfo endpoint (default https://api.github.com/user). */
  userinfoEndpoint?: string
  /** Override emails endpoint (default https://api.github.com/user/emails). */
  userEmailsEndpoint?: string
}
