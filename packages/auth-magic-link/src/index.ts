// @theokit/auth-magic-link v0.1.0 — email magic-link provider.
//
// Per plan g11-auth-architecture-implementation T4.1:
// - 32-byte URL-safe random tokens (crypto.randomBytes).
// - Pluggable MagicLinkStore (ADR D7) — createMemoryStore / createOrmStore.
// - Consumer-supplied sendEmail callback (ADR D8) — apps wire any transport;
// errors propagate (not swallowed).
// - Token lifetime default 15 min (configurable via opts.tokenLifetimeMs).
// - Single-use atomic consumption (EC-11 SHOULD TEST).
// - Email validation at input boundary (EC-12 SHOULD TEST): missing /
// malformed email throws BEFORE token creation.

import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { AuthProvider, AuthResult, OAuthTransaction } from '@theokit/sdk/server/auth'
import type { MagicLinkProfile, MagicLinkProviderOptions } from './types.js'

export type {
  MagicLinkProfile,
  MagicLinkProviderOptions,
  MagicLinkStore,
  MagicLinkTokenRecord,
  SendMagicLinkFn,
} from './types.js'
export { createMemoryStore, createOrmStore } from './store.js'
export type { MagicLinkRepository } from './store.js'

const DEFAULT_LIFETIME_MS = 15 * 60 * 1000
const DEFAULT_CALLBACK_PATH = '/api/auth/magic-link/callback'
const DEFAULT_CHECK_EMAIL_PAGE = '/auth/check-email'
const TOKEN_BYTES = 32
// #204: hard cap on the bare-case request body we will buffer (DoS guard).
const MAX_BODY_BYTES = 16 * 1024
// Minimal email guard — full RFC 5322 is overkill. Catches obvious invalids;
// real validation happens at the auth provider (SMTP / IdP) layer.
const EMAIL_GUARD = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Raised when a sign-in attempt fails on its own terms — a token that is missing, expired, already
 * spent, or an address that fails validation at the boundary.
 *
 * Distinct from {@link MagicLinkConfigError}: this one is reachable by an ordinary user doing an
 * ordinary thing, and is not a defect in the wiring.
 */
export class MagicLinkAuthError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MagicLinkAuthError'
    this.code = code
  }
}

/**
 * Raised when the provider itself is wired wrong — a missing store, an unusable callback URL.
 *
 * Separate from {@link MagicLinkAuthError} because the audiences differ: this one is for whoever
 * deployed the app, never for the person clicking the link, and no retry will clear it.
 */
export class MagicLinkConfigError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MagicLinkConfigError'
    this.code = code
  }
}

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

async function defaultResolveEmail(req: IncomingMessage): Promise<string | null> {
  // Try query string first
  const url = new URL(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`)
  const qs = url.searchParams.get('email')
  if (qs) return qs.toLowerCase().trim()
  // Fall back to form-data body. Buffer raw bytes (consumer may use middleware
  // that already parsed; that's the consumer's job — we only handle the bare case).
  if (req.method === 'POST' || req.method === 'PUT') {
    // #204: cap the body to avoid unbounded buffering (DoS). Count bytes as we
    // read and bail the instant we exceed the cap — never accumulate a hostile
    // payload. The stream read is OUTSIDE any try/catch so a transport/stream
    // error propagates instead of being swallowed to null (#209).
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
      total += chunk.length
      if (total > MAX_BODY_BYTES) return null // oversized → treated as invalid email
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks).toString('utf8')
    const ct = (req.headers['content-type'] ?? '').toLowerCase()
    if (ct.includes('application/json')) {
      // #209: narrow the catch to JSON parse errors only — malformed JSON is a
      // client error (→ null), but a transport error must NOT be swallowed here.
      let json: { email?: unknown }
      try {
        json = JSON.parse(body) as { email?: unknown }
      } catch (err) {
        if (err instanceof SyntaxError) return null
        throw err
      }
      return typeof json.email === 'string' ? json.email.toLowerCase().trim() : null
    }
    if (ct.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(body)
      const email = params.get('email')
      return email ? email.toLowerCase().trim() : null
    }
  }
  return null
}

function validateEmail(email: string | null): string {
  if (!email || !email.trim()) {
    throw new MagicLinkConfigError(
      'invalid_email',
      'Magic-link sign-in requires an email field in the request',
    )
  }
  const normalized = email.toLowerCase().trim()
  if (!EMAIL_GUARD.test(normalized)) {
    throw new MagicLinkConfigError(
      'invalid_email',
      `Email "${normalized}" failed basic shape validation`,
    )
  }
  return normalized
}

/**
 * Email magic-link provider for `defineAuth`.
 *
 * Tokens are 32 bytes of `crypto.randomBytes`, URL-safe, and single-use: consumption is atomic, so
 * two concurrent clicks on the same link resolve exactly one. The address is validated before a
 * token is ever created, which keeps a malformed input from costing a store write and an email.
 *
 * A magic-link token is an unbound bearer credential — anyone holding the URL is the user — so the
 * lifetime is short by default (15 minutes) and the raw token is never persisted; stores keep only
 * its SHA-256. Delivery is the consumer's `sendEmail`, and its errors propagate rather than being
 * swallowed: a link that was never delivered must not read as a link that was sent.
 */
export function magicLink(opts: MagicLinkProviderOptions): AuthProvider<
  MagicLinkProfile,
  'magic-link'
> & {
  /** Begin sign-in: validate email, persist token, send email. Returns the redirect URL. */
  startSignIn(req: IncomingMessage): Promise<URL>
} {
  const lifetimeMs = opts.tokenLifetimeMs ?? DEFAULT_LIFETIME_MS
  const callbackPath = opts.callbackPath ?? DEFAULT_CALLBACK_PATH
  const checkPage = opts.checkEmailPage ?? DEFAULT_CHECK_EMAIL_PAGE
  const resolveEmail = opts.resolveEmail ?? defaultResolveEmail

  // #205: validate callbackBaseUrl shape at factory init (fail fast) so a bad
  // config surfaces at construction, not at the first sign-in request.
  let parsedBase: URL
  try {
    parsedBase = new URL(opts.callbackBaseUrl)
  } catch {
    throw new MagicLinkConfigError(
      'invalid_callback_base_url',
      `callbackBaseUrl "${opts.callbackBaseUrl}" is not an absolute URL`,
    )
  }
  if (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') {
    throw new MagicLinkConfigError(
      'invalid_callback_base_url',
      `callbackBaseUrl must use http(s), got "${parsedBase.protocol}"`,
    )
  }

  return {
    name: 'magic-link',

    async startSignIn(req: IncomingMessage): Promise<URL> {
      const rawEmail = await resolveEmail(req)
      const email = validateEmail(rawEmail)
      const token = generateToken()
      const expiresAt = new Date(Date.now() + lifetimeMs)

      await opts.store.createToken({ email, token, expiresAt })

      // #205: build the callback URL via the URL API so the base/path join is
      // normalized (no double slash when the base has a trailing slash) and the
      // token is encoded by searchParams.
      const magicLinkUrlObj = new URL(callbackPath, opts.callbackBaseUrl)
      magicLinkUrlObj.searchParams.set('token', token)
      const magicLinkUrl = magicLinkUrlObj.toString()
      // EC: emit email; errors propagate (D8 invariant — never swallowed)
      await opts.sendEmail({ to: email, magicLinkUrl, expiresAt, token })

      return new URL(checkPage, opts.callbackBaseUrl)
    },

    createAuthorizationURL(_tx: OAuthTransaction): Promise<URL> {
      return Promise.reject(
        new MagicLinkConfigError(
          'use_start_sign_in',
          'magic-link does not use OAuth authorization flow — call provider.startSignIn(req) directly',
        ),
      )
    },

    /**
     * #190 (documented-bearer model): magic-link tokens are INTENTIONALLY
     * unbound bearer credentials — `_tx` (the OAuth cookie-state transaction) is
     * deliberately NOT validated here. Unlike github/google, magic-link has no
     * redirect round-trip and is cross-device by design (the user may click the
     * email link on a different device than the one that called `startSignIn`, so
     * no initiating-browser `tx.state` cookie is present). Binding to `tx.state`
     * would break that core feature, and an "optional" binding is security
     * theatre (an attacker simply omits the cookie). Security rests instead on:
     * 32-byte token entropy, a short TTL (15 min default), atomic single-use
     * consumption, and hash-at-rest (#191). NOTE: this supersedes the plan's
     * ADR D6 binding option, whose rejection of the bearer model was based on a
     * false premise (magic-link throws in `createAuthorizationURL` and has no
     * tx-producing issuance path). See CHANGELOG / changeset for the correction.
     */
    async handleCallback(
      req: IncomingMessage,
      _tx: OAuthTransaction,
    ): Promise<AuthResult<MagicLinkProfile, 'magic-link'>> {
      const url = new URL(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`)
      const token = url.searchParams.get('token')
      if (!token) {
        throw new MagicLinkAuthError(
          'missing_token',
          'Magic-link callback URL missing token query param',
        )
      }
      const record = await opts.store.consumeToken({ token })
      if (!record) {
        throw new MagicLinkAuthError(
          'invalid_or_expired_token',
          'Magic-link token is missing, expired, or already used',
        )
      }
      return {
        profile: { email: record.email, verifiedAt: new Date() },
        providerName: 'magic-link',
      }
    },
  }
}
