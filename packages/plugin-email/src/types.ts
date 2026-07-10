/**
 * @theokit/plugin-email — types.
 *
 * Per plan p7-plugin-email v1.0 + blueprint v1.0 (SHIPPABLE 100/100).
 * Form 4 Hybrid — EmailProvider interface + ResendProvider default.
 */

/**
 * Canonical email message shape — provider-agnostic. Consumers build these
 * via direct construction or via `defineEmailTemplate(name, render)`.
 */
export interface EmailMessage {
  readonly to: string | readonly string[]
  readonly from: string
  readonly subject: string
  readonly html: string
  readonly text?: string
  readonly cc?: string | readonly string[]
  readonly bcc?: string | readonly string[]
  readonly replyTo?: string
  /**
   * Stable idempotency key. ResendProvider maps to `Idempotency-Key` HTTP
   * header per Resend's documented dedup behavior. Consumer is responsible
   * for generating stable keys per logical message.
   */
  readonly idempotencyKey?: string
  /** Additional HTTP headers passed to the provider. */
  readonly headers?: Record<string, string>
}

/** Result returned by `EmailProvider.send`. */
export interface SendResult {
  /** Provider-assigned message ID (e.g., Resend `re_xxx`). */
  readonly id: string
  /** Provider name (e.g., "resend"). */
  readonly provider: string
  /** Raw provider response for diagnostic purposes (may be omitted). */
  readonly raw?: unknown
}

/**
 * Email provider contract — single `send(message): Promise<SendResult>` method.
 * Consumers can implement this directly OR use the canonical `ResendProvider`
 * factory.
 */
export interface EmailProvider {
  /** Provider identifier (e.g., "resend", "smtp", "ses"). */
  readonly name: string
  /** Send an email. Throws `EmailSendError` on provider error. */
  send(message: EmailMessage): Promise<SendResult>
}

/** Typed error wrapping provider-side send failures. */
export class EmailSendError extends Error {
  override readonly name = 'EmailSendError'
  readonly provider: string
  readonly raw: unknown
  constructor(message: string, opts: { provider: string; raw?: unknown; cause?: unknown }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.provider = opts.provider
    this.raw = opts.raw
  }
}
