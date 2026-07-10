/**
 * @theokit/plugin-email — Stripe-like email plugin for TheoKit.
 *
 * Per plan p7-plugin-email v1.0 + blueprint v1.0 (SHIPPABLE 100/100).
 * Form 4 Hybrid: EmailProvider interface + ResendProvider default + React
 * Email opt-in peer + canonical magic-link template helper.
 *
 * @public
 */

// Types + canonical contract
export type { EmailMessage, EmailProvider, SendResult } from './types.js'
export { EmailSendError } from './types.js'

// Provider extension helper (consumer custom implementations)
export { defineEmailProvider } from './provider.js'

// Resend default provider
export {
  ResendProvider,
  type ResendClientLike,
  type ResendProviderOptions,
} from './resend-provider.js'

// Template factory
export { defineEmailTemplate, type EmailTemplate, type RenderedTemplate } from './templates.js'

// React Email dynamic-import bridge
export { renderReactEmail } from './render-react-email.js'

// Magic-link integration (returns SendMagicLinkFn-compatible function)
export {
  sendMagicLink,
  defaultMagicLinkHtml,
  defaultMagicLinkText,
  type SendMagicLinkFn,
  type SendMagicLinkOptions,
} from './magic-link.js'
