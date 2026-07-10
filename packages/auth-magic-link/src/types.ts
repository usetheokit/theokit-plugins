/**
 * @theokit/auth-magic-link — public types.
 *
 * Per plan G11 ADR D7 (pluggable store) + D8 (consumer-supplied email callback).
 */

import type { IncomingMessage } from 'node:http'

export interface MagicLinkProfile {
  email: string
  verifiedAt: Date
}

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
