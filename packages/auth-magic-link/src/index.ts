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

/**
 * True when the request is a Web `Request` rather than Node's `IncomingMessage`.
 *
 * Duck-typed on `headers.get` instead of `instanceof Request`: the global is absent on some
 * runtimes and `instanceof` fails across realms, both of which would silently send a Web request
 * down the Node path and read a body that is not there.
 */
function isWebRequest(req: IncomingMessage | Request): req is Request {
  return typeof (req as Request).headers?.get === 'function'
}

/** The request URL, from either shape. Only the query string is read from the result. */
function requestUrl(req: IncomingMessage | Request): URL {
  if (isWebRequest(req)) return new URL(req.url)
  return new URL(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`)
}

/**
 * The body, capped at {@link MAX_BODY_BYTES}, or `null` when the cap is exceeded.
 *
 * #204: the cap is the point. `Request.text()` would be one line and would buffer a hostile payload
 * in full before anyone could object, so the stream is read chunk by chunk and abandoned the moment
 * it grows too large — the same guarantee the `IncomingMessage` path has always given.
 *
 * The read is deliberately OUTSIDE any try/catch (#209): a transport error must propagate, not be
 * flattened into "no email in this request".
 */
async function readCappedBody(req: IncomingMessage | Request): Promise<string | null> {
  if (isWebRequest(req)) {
    const stream = req.body
    if (stream === null) return ''
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) return null // oversized → treated as invalid email
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The `content-type` header, lower-cased, from either shape. */
function contentType(req: IncomingMessage | Request): string {
  const raw = isWebRequest(req)
    ? (req.headers.get('content-type') ?? '')
    : (req.headers['content-type'] ?? '')
  return raw.toLowerCase()
}

/** The address in a body a framework already parsed, or null when there is not one. */
function emailFromParsedBody(parsedBody: unknown): string | null {
  if (typeof parsedBody !== 'object' || parsedBody === null) return null
  const { email } = parsedBody as { email?: unknown }
  return typeof email === 'string' ? email.toLowerCase().trim() : null
}

async function defaultResolveEmail(
  req: IncomingMessage | Request,
  parsedBody?: unknown,
): Promise<string | null> {
  // Try query string first
  const qs = requestUrl(req).searchParams.get('email')
  if (qs) return qs.toLowerCase().trim()
  // A body the framework already parsed replaces reading the stream — it does not merely come
  // first. Inside a TheoKit route the stream is already consumed and the Request carries no
  // body, so there is nothing left to fall back to (#101).
  if (parsedBody !== undefined) return emailFromParsedBody(parsedBody)
  // Fall back to form-data body. Buffer raw bytes (consumer may use middleware
  // that already parsed; that's the consumer's job — we only handle the bare case).
  if (req.method === 'POST' || req.method === 'PUT') {
    const body = await readCappedBody(req)
    if (body === null) return null
    const ct = contentType(req)
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
export function magicLink(opts: MagicLinkProviderOptions): Omit<
  AuthProvider<MagicLinkProfile, 'magic-link'>,
  'handleCallback'
> & {
  /**
   * Begin sign-in: validate email, persist token, send email. Returns the redirect URL.
   *
   * `parsedBody` is for callers whose framework already read the body. TheoKit is one: its route
   * handler receives a `Request` with no body and the parsed value as `ctx.body`, so
   * `startSignIn(request)` alone cannot reach the address (#101). Pass it through and the
   * composition works: `startSignIn(request, body)`.
   */
  startSignIn(req: IncomingMessage | Request, parsedBody?: unknown): Promise<URL>
  /**
   * Consume the token and resolve the identity.
   *
   * Accepts a Web `Request` as well as Node's `IncomingMessage`: the SDK's `AuthProvider` types this
   * parameter as the Node shape, and TheoKit's route handler hands the Web one (#68).
   */
  handleCallback(
    req: IncomingMessage | Request,
    tx: OAuthTransaction,
  ): Promise<AuthResult<MagicLinkProfile, 'magic-link'>>
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

    async startSignIn(req: IncomingMessage | Request, parsedBody?: unknown): Promise<URL> {
      const rawEmail = await resolveEmail(req, parsedBody)
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
      req: IncomingMessage | Request,
      _tx: OAuthTransaction,
    ): Promise<AuthResult<MagicLinkProfile, 'magic-link'>> {
      const url = requestUrl(req)
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
