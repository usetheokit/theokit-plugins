// @theokit/auth-magic-link — public types.
//
// Per plan G11 ADR D7 (pluggable store) + D8 (consumer-supplied email callback).

import type { IncomingMessage } from 'node:http'

/**
 * The identity a consumed magic link proves: an address, and the moment it was proven.
 *
 * There is no name, picture or id, because a magic link asserts control of a mailbox and nothing
 * else. `verifiedAt` is the consumption time, not the send time — a link that was issued and never
 * clicked produces no profile at all.
 */
export interface MagicLinkProfile {
  email: string
  verifiedAt: Date
}

/**
 * What a store returns when a token is successfully consumed.
 *
 * It carries no token field on purpose: by the time this exists the token is spent, and handing it
 * back would invite a caller to reuse a credential the store has already invalidated.
 */
export interface MagicLinkTokenRecord {
  email: string
  expiresAt: Date
}

/**
 * Pluggable token storage. Per ADR D7: atomicity contract — `consumeToken`
 * MUST be single-use (concurrent reads of the same token → exactly one wins,
 * subsequent reads return null).
 */
export interface MagicLinkStore {
  createToken(args: { email: string; token: string; expiresAt: Date }): Promise<void>
  /** Returns the record if the token is consumable; null if missing / expired / already consumed. */
  consumeToken(args: { token: string }): Promise<MagicLinkTokenRecord | null>
  revokeToken(args: { token: string }): Promise<void>
  /** Returns count of expired entries removed (for periodic cleanup jobs). */
  cleanupExpired(): Promise<number>
}

/**
 * Email-callback contract — D8. Apps wire any transport (Resend, SendGrid,
 * SMTP, console.log for dev). Errors propagate; the provider never swallows.
 */
export type SendMagicLinkFn = (args: {
  to: string
  magicLinkUrl: string
  expiresAt: Date
  token: string
}) => Promise<void>

/**
 * Options for {@link magicLink}.
 *
 * `store` and `sendEmail` have no defaults and cannot: persistence and delivery are the two things
 * this package deliberately does not choose for you (ADR D7, D8). Anything a default could get
 * wrong here — losing tokens on restart, mailing through the wrong transport — is worse than an
 * explicit argument.
 */
export interface MagicLinkProviderOptions {
  store: MagicLinkStore
  sendEmail: SendMagicLinkFn
  /** Base URL where /callback?token=... will resolve (no trailing slash). */
  callbackBaseUrl: string
  /** Path appended to callbackBaseUrl. Defaults to '/api/auth/magic-link/callback'. */
  callbackPath?: string
  /** Token lifetime. Defaults to 15 min. */
  tokenLifetimeMs?: number
  /** Page to redirect after start (e.g., "check your email"). Defaults to '/auth/check-email'. */
  checkEmailPage?: string
  /** Source of email when starting sign-in. Defaults to reading req.body.email or req.url ?email=. */
  resolveEmail?: (req: IncomingMessage) => Promise<string | null>
}
