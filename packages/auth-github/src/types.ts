/**
 * @theokit/auth-github — public types.
 *
 * Per plan G11 ADR D9: per-provider profile type.
 * - `id` is numeric (GitHub user IDs are bigints exposed as JSON numbers).
 *   Preserve as `number`, NOT string.
 * - `email` may be undefined when the granted scope omits `user:email` AND
 *   the user has no public email on their profile.
 */

export interface GitHubProfile {
  id: number
  login: string
  name?: string | null
  email?: string | null
  avatar_url?: string
}

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
