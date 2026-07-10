/**
 * @theokit/plugin-email — canonical magic-link template + sender helper.
 *
 * Per plan p7-plugin-email v1.0 § Phase 2 / T2.3.
 * Blueprint ADR D4 — `sendMagicLink(provider, opts)` returns a
 * `SendMagicLinkFn`-compatible function (type imported via type-only;
 * no runtime coupling to `@theokit/auth-magic-link`).
 */

import type { EmailProvider } from './types.js'

/**
 * Structural copy of `@theokit/auth-magic-link`'s `SendMagicLinkFn` shape.
 * Kept inline (NOT a `type {}` import) so plugin-email has zero runtime
 * dependency on auth-magic-link — consumer composition is fully decoupled.
 */
export type SendMagicLinkFn = (args: {
  to: string
  magicLinkUrl: string
  expiresAt: Date
  token: string
}) => Promise<void>

/** Options for the canonical `sendMagicLink` helper. */
export interface SendMagicLinkOptions {
  /** Sender address (e.g., `"Acme <noreply@app.test>"`). */
  readonly from: string
  /** App name used in default subject + body. Default: "your app". */
  readonly appName?: string
  /** Customize the subject line. Default: `"Sign in to {appName}"`. */
  readonly subject?: (ctx: { to: string; appName: string }) => string
  /** Customize the HTML body. Default: plain-string template with magic link + expiry hint. */
  readonly renderHtml?: (ctx: {
    magicLinkUrl: string
    expiresAt: Date
    appName: string
  }) => string | Promise<string>
  /** Customize the plain-text body. Default: plain-string template. */
  readonly renderText?: (ctx: {
    magicLinkUrl: string
    expiresAt: Date
    appName: string
  }) => string | Promise<string>
  /**
   * Optional generator for `EmailMessage.idempotencyKey`. Default: derive
   * from token (which is unique per magic-link). Pass `null` to disable.
   */
  readonly idempotencyKey?: ((ctx: { token: string }) => string) | null
}

/**
 * Default magic-link HTML body (plain string — no React Email required).
 *
 * Mirrors common modern saas patterns: app name, single CTA button-styled
 * link, expiry hint, plain-text fallback ASCII representation.
 *
 * @public
 */
export function defaultMagicLinkHtml(ctx: {
  magicLinkUrl: string
  expiresAt: Date
  appName: string
}): string {
  const expiresMins = Math.max(1, Math.round((ctx.expiresAt.getTime() - Date.now()) / 60000))
  return [
    `<!doctype html>`,
    `<html><body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5;">`,
    `<h1 style="font-size: 18px; margin: 0 0 16px;">Sign in to ${escapeHtml(ctx.appName)}</h1>`,
    `<p>Click the link below to sign in. The link expires in ${expiresMins} minutes.</p>`,
    `<p><a href="${escapeAttr(ctx.magicLinkUrl)}" style="display: inline-block; background: #111; color: #fff; padding: 10px 16px; text-decoration: none; border-radius: 6px;">Sign in</a></p>`,
    `<p style="color: #666; font-size: 13px;">If the button doesn't work, paste this URL into your browser:</p>`,
    `<p style="color: #666; font-size: 13px; word-break: break-all;">${escapeHtml(ctx.magicLinkUrl)}</p>`,
    `</body></html>`,
  ].join('\n')
}

/** Default magic-link plain-text body. */
export function defaultMagicLinkText(ctx: {
  magicLinkUrl: string
  expiresAt: Date
  appName: string
}): string {
  const expiresMins = Math.max(1, Math.round((ctx.expiresAt.getTime() - Date.now()) / 60000))
  return [
    `Sign in to ${ctx.appName}`,
    ``,
    `Click the link below to sign in. The link expires in ${expiresMins} minutes.`,
    ``,
    ctx.magicLinkUrl,
  ].join('\n')
}

/**
 * Build a `SendMagicLinkFn`-compatible function backed by the given email
 * provider.
 *
 * Returns a function that satisfies `@theokit/auth-magic-link`'s
 * `MagicLinkProviderOptions.sendEmail` contract — pass it directly:
 *
 * ```ts
 * import { ResendProvider, sendMagicLink } from "@theokit/plugin-email";
 * import { magicLink } from "@theokit/auth-magic-link";
 *
 * const email = ResendProvider({ apiKey: process.env.RESEND_API_KEY });
 *
 * magicLink({
 *   store,
 *   callbackBaseUrl: "https://app.test",
 *   sendEmail: sendMagicLink(email, { from: "Acme <noreply@app.test>", appName: "Acme" }),
 * });
 * ```
 *
 * @public
 */
export function sendMagicLink(
  provider: EmailProvider,
  opts: SendMagicLinkOptions,
): SendMagicLinkFn {
  const appName = opts.appName ?? 'your app'
  const buildSubject =
    opts.subject ?? ((ctx: { to: string; appName: string }) => `Sign in to ${ctx.appName}`)
  const buildHtml = opts.renderHtml ?? defaultMagicLinkHtml
  const buildText = opts.renderText ?? defaultMagicLinkText
  const buildIdempotencyKey =
    opts.idempotencyKey === null
      ? null
      : (opts.idempotencyKey ?? ((ctx: { token: string }) => `magic_link:${ctx.token}`))

  return async (args) => {
    const ctx = {
      magicLinkUrl: args.magicLinkUrl,
      expiresAt: args.expiresAt,
      appName,
    }
    const subject = buildSubject({ to: args.to, appName })
    const [html, text] = await Promise.all([
      Promise.resolve(buildHtml(ctx)),
      Promise.resolve(buildText(ctx)),
    ])
    await provider.send({
      from: opts.from,
      to: args.to,
      subject,
      html,
      text,
      idempotencyKey:
        buildIdempotencyKey !== null ? buildIdempotencyKey({ token: args.token }) : undefined,
    })
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
