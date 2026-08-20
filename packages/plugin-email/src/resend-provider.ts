/**
 * @theokit/plugin-email — Resend default provider.
 *
 * Per plan p7-plugin-email v1.0 § Phase 1 / T1.3.
 * Blueprint ADR D2 — Resend is required peer.
 *
 * Wraps `new Resend(apiKey)` + `resend.emails.send()`. Maps `EmailMessage`
 * to Resend's API shape.
 *
 * `idempotencyKey` goes in the SDK's SECOND argument, not in the payload.
 * `payload.headers` are MIME headers of the message; the deduplication header
 * is an HTTP header of the request, and the SDK exposes it only as
 * `send(payload, { idempotencyKey })` (`CreateEmailRequestOptions`, resend
 * 4.8.0: "If provided, will be sent as the `Idempotency-Key` header").
 *
 * Until 2026-08-17 it was written into `payload.headers`, which made the key a
 * decorative MIME header and meant Resend never deduplicated anything. The unit
 * test asserted the wrong location under the right name, so it passed; the live
 * e2e suite sent the same key twice, got two different ids back, and that is
 * how it was found.
 */

import type { EmailMessage, EmailProvider, SendResult } from './types.js'
import { EmailSendError } from './types.js'

/** Payload shape passed to Resend's `emails.send()` after EmailMessage mapping. */
export interface ResendSendPayload {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  headers?: Record<string, string>
}

/**
 * Request-level options. Distinct from the payload on purpose: these become HTTP
 * headers, while the payload becomes the message.
 */
export interface ResendSendRequestOptions {
  idempotencyKey?: string
}

/**
 * Resend SDK shape (structurally typed). Plugin's source does NOT import the
 * runtime `Resend` class directly — consumer's installed `resend` peer
 * provides the instance via `ResendProvider({client})` OR plugin creates one
 * via `new Resend(apiKey)` when `client` absent.
 */
export interface ResendClientLike {
  emails: {
    send(
      payload: ResendSendPayload,
      options?: ResendSendRequestOptions,
    ): Promise<{
      data?: { id: string } | null
      error?: { message?: string; name?: string } | null
    }>
  }
}

/** Second argument to `emails.send`, omitted entirely when there is nothing to send. */
function requestOptions(message: EmailMessage): ResendSendRequestOptions | undefined {
  return message.idempotencyKey === undefined
    ? undefined
    : { idempotencyKey: message.idempotencyKey }
}

/**
 * Options for the Resend-backed provider. Exactly one of `apiKey` or `client` is required.
 *
 * `client` exists so a test can drive a stub and so an app that already configured Resend can share
 * that instance instead of opening a second one. When both are absent the provider throws at
 * construction rather than on the first send, so a misconfigured deployment fails at boot.
 */
export interface ResendProviderOptions {
  /** Resend API key. Required when `client` not provided. */
  apiKey?: string
  /** Pre-configured Resend client (for tests, custom config, or sharing). */
  client?: ResendClientLike
}

/**
 * Create a canonical Resend-backed EmailProvider.
 *
 * Either `apiKey` (constructs new Resend client) or `client` (uses provided
 * instance) is required.
 *
 * @public
 */
export function ResendProvider(opts: ResendProviderOptions): EmailProvider {
  if (!opts.apiKey && !opts.client) {
    throw new Error(
      'ResendProvider requires either { apiKey } or { client }. Pass process.env.RESEND_API_KEY or a pre-built Resend client.',
    )
  }
  return {
    name: 'resend',
    async send(message: EmailMessage): Promise<SendResult> {
      const client = opts.client ?? (await createDefaultClient(opts.apiKey ?? ''))
      const payload = buildPayload(message)
      let result: Awaited<ReturnType<ResendClientLike['emails']['send']>>
      try {
        result = await client.emails.send(payload, requestOptions(message))
      } catch (cause) {
        throw new EmailSendError('Resend send failed', {
          provider: 'resend',
          raw: cause,
          cause,
        })
      }
      if (result.error || !result.data) {
        throw new EmailSendError(
          `Resend send returned error: ${result.error?.message ?? 'unknown'}`,
          { provider: 'resend', raw: result.error, cause: result.error },
        )
      }
      return { id: result.data.id, provider: 'resend', raw: result }
    },
  }
}

/**
 * MIME headers of the message. `idempotencyKey` is deliberately NOT merged in
 * here — it is a request header, handled in the send options.
 */
function buildHeaders(message: EmailMessage): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(message.headers ?? {}) }
  return Object.keys(headers).length > 0 ? headers : undefined
}

/** Copy a recipient field to a mutable shape, preserving string-vs-array. */
function toMutableRecipients(value: string | readonly string[]): string | string[] {
  return typeof value === 'string' ? value : [...value]
}

/** Translate `EmailMessage` to `ResendSendPayload`, omitting undefined fields. */
function buildPayload(message: EmailMessage): ResendSendPayload {
  const payload: ResendSendPayload = {
    from: message.from,
    to: toMutableRecipients(message.to),
    subject: message.subject,
    html: message.html,
  }
  if (message.text !== undefined) payload.text = message.text
  if (message.cc !== undefined) {
    payload.cc = toMutableRecipients(message.cc)
  }
  if (message.bcc !== undefined) {
    payload.bcc = toMutableRecipients(message.bcc)
  }
  if (message.replyTo !== undefined) payload.replyTo = message.replyTo
  const headers = buildHeaders(message)
  if (headers !== undefined) payload.headers = headers
  return payload
}

/**
 * Lazy default Resend client construction. Imports `resend` peer dynamically
 * so consumers who supply their own `client` don't trigger the require.
 */
async function createDefaultClient(apiKey: string): Promise<ResendClientLike> {
  let mod: { Resend: new (key: string) => ResendClientLike }
  try {
    mod = (await import('resend')) as unknown as typeof mod
  } catch (cause) {
    throw new Error('Resend SDK not installed. Run `pnpm add resend` to use ResendProvider.', {
      cause,
    })
  }
  return new mod.Resend(apiKey)
}
