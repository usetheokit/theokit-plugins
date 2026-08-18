/**
 * Magic-link — the message our template produces, sent through the real Resend API.
 *
 * `packages/plugin-email/tests/integration/magic-link-seam.test.ts` proves the adapter
 * satisfies the port, offline, against a capturing provider. `tests/email/live.test.ts`
 * proves Resend accepts a payload — but the payload it sends is a hand-built
 * `<p>marker</p>`, not the magic-link template. So the thing a user actually receives
 * has never been through the real API.
 *
 * This suite closes that: real `magicLink()`, real `sendMagicLink()`, real
 * `ResendProvider`, real HTTP. The provider is wrapped by a recorder that FORWARDS to
 * it — the send is genuine; the wrapper only reads the message on the way past, so the
 * assertions can be made against the bytes that were actually transmitted rather than
 * against a re-render.
 *
 * ── WHAT THIS DOES NOT PROVE ────────────────────────────────────────────────────
 *
 * Nobody read this email from an inbox. Two measured reasons:
 *
 *   1. `EMAIL_TEST_RECIPIENT` is on `resend.dev`, Resend's sandbox address. It accepts
 *      and discards; there is no mailbox behind it.
 *   2. `RESEND_API_KEY` is send-restricted — `GET /emails` answers
 *      `401 restricted_api_key: This API key is restricted to only send emails`, so the
 *      message cannot even be read back from Resend's own store.
 *
 * The link asserted below is therefore the one WE transmitted, recovered from the
 * outgoing HTML, not one recovered from a delivered message. That last leg stays open as
 * B-004, and this file is deliberately named for what it covers so nobody reads it as
 * the whole journey. Widening these assertions to imply delivery would be exactly the
 * "send-only assertion that claims more than it proves" B-004's own DoD refuses.
 */

import { createMemoryStore, magicLink } from '@theokit/auth-magic-link'
import { ResendProvider, sendMagicLink } from '@theokit/plugin-email'
import type { EmailMessage, EmailProvider, SendResult } from '@theokit/plugin-email'
import { expect, it } from 'vitest'

import type { IncomingMessage } from 'node:http'

import { required, runMarker } from '../../src/credentials.js'
import { describeLive } from '../../src/harness.js'
import { serviceById } from '../../src/services.js'

const EMAIL = serviceById('email')

/**
 * Wraps the real provider: forwards every send, and keeps both the message that went
 * past AND what the API answered.
 *
 * Recording the RESULT is not decoration. Without it these tests assert only the
 * message we handed over, which a short-circuited send would satisfy just as well —
 * the same way `db studio` once passed on "not refused" while being entirely broken.
 * The answer is the only evidence that Resend was actually reached.
 */
function recording(inner: EmailProvider): {
  provider: EmailProvider
  sent: EmailMessage[]
  results: SendResult[]
} {
  const sent: EmailMessage[] = []
  const results: SendResult[] = []
  return {
    sent,
    results,
    provider: {
      name: inner.name,
      async send(message: EmailMessage): Promise<SendResult> {
        sent.push(message)
        const result = await inner.send(message)
        results.push(result)
        return result
      },
    },
  }
}

/** Resend answers with a UUID for a message id — never an `re_…` key shape. */
const RESEND_MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function onlyResult(results: readonly SendResult[]): SendResult {
  expect(results, 'the provider returned nothing — the API was not reached').toHaveLength(1)
  const result = results[0]
  if (result === undefined) throw new Error('unreachable: length asserted above')
  expect(result.provider).toBe('resend')
  expect(result.id, 'not a Resend message id').toMatch(RESEND_MESSAGE_ID)
  return result
}

function signInRequest(email: string): IncomingMessage {
  const body = JSON.stringify({ email })
  async function* chunks() {
    yield Buffer.from(body, 'utf8')
  }
  const req = chunks() as unknown as IncomingMessage
  Object.assign(req, {
    method: 'POST',
    url: '/auth/magic-link/start',
    headers: { host: 'app.usetheo.dev', 'content-type': 'application/json' },
  })
  return req
}

function callbackRequest(url: string): IncomingMessage {
  const parsed = new URL(url)
  return {
    method: 'GET',
    url: `${parsed.pathname}${parsed.search}`,
    headers: { host: parsed.host },
  } as unknown as IncomingMessage
}

/** The href a mail client would follow — `&amp;` un-escaped, as a browser does. */
function hrefFromHtml(html: string): string {
  const href = /<a[^>]+href="([^"]+)"/.exec(html)?.[1]
  if (href === undefined) throw new Error(`no anchor href in the sent email:\n${html}`)
  return href
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function onlyMessage(sent: readonly EmailMessage[]): EmailMessage {
  expect(sent, 'the adapter never reached the provider').toHaveLength(1)
  const message = sent[0]
  if (message === undefined) throw new Error('unreachable: length asserted above')
  return message
}

function wire(marker: string) {
  const { provider, sent, results } = recording(
    ResendProvider({ apiKey: required('RESEND_API_KEY') }),
  )
  const auth = magicLink({
    store: createMemoryStore(),
    callbackBaseUrl: 'https://app.usetheo.dev',
    sendEmail: sendMagicLink(provider, {
      from: required('RESEND_FROM_ADDRESS'),
      appName: 'TheoKit',
      // The marker is how a human finds this run in the Resend dashboard later;
      // every other field is the template's own default, on purpose — a custom
      // renderer here would test our override instead of what ships.
      subject: () => `${marker} magic-link live probe`,
    }),
  })
  return { auth, sent, results }
}

describeLive(EMAIL, 'magic-link outbound', () => {
  it('Resend accepts the message the magic-link template produces', async () => {
    const marker = runMarker()
    const { auth, sent, results } = wire(marker)

    // `startSignIn` mints the token, persists it, and sends. A rejection from Resend
    // propagates out of here — the D8 invariant is that errors are never swallowed.
    const redirect = await auth.startSignIn(signInRequest(required('EMAIL_TEST_RECIPIENT')))

    expect(redirect.toString()).toContain('app.usetheo.dev')

    // Proof the real API answered, before anything is claimed about the payload.
    onlyResult(results)

    const message = onlyMessage(sent)
    expect(message.to).toBe(required('EMAIL_TEST_RECIPIENT'))
    expect(message.from).toBe(required('RESEND_FROM_ADDRESS'))
    expect(message.subject).toContain(marker)
    // Both parts are populated by the shipped template, not by an override.
    expect(typeof message.html, 'template rendered no HTML').toBe('string')
    expect(typeof message.text, 'template rendered no text part').toBe('string')
  }, 60_000)

  it('the link inside the transmitted message signs the user in', async () => {
    const marker = runMarker()
    const { auth, sent, results } = wire(marker)
    const recipient = required('EMAIL_TEST_RECIPIENT')

    await auth.startSignIn(signInRequest(recipient))
    onlyResult(results)

    // The href is read out of the HTML that went over the wire to Resend. This is the
    // strongest claim available without a readable mailbox: the bytes are the sent
    // ones, and the consumption is real. It is NOT proof of delivery — see the header.
    const clicked = hrefFromHtml(onlyMessage(sent).html as string)
    expect(clicked).toContain('https://app.usetheo.dev')

    const result = await auth.handleCallback(callbackRequest(clicked), {} as never)
    expect(result.profile.email).toBe(recipient)
  }, 60_000)

  it('a token Resend already carried is still single-use', async () => {
    // Each package proves single-use against its own store. This proves it holds for a
    // token that has been through a real send — the path a user's token takes.
    const marker = runMarker()
    const { auth, sent, results } = wire(marker)

    await auth.startSignIn(signInRequest(required('EMAIL_TEST_RECIPIENT')))
    onlyResult(results)
    const clicked = hrefFromHtml(onlyMessage(sent).html as string)

    await auth.handleCallback(callbackRequest(clicked), {} as never)
    await expect(
      auth.handleCallback(callbackRequest(clicked), {} as never),
    ).rejects.toMatchObject({ name: 'MagicLinkAuthError', code: 'invalid_or_expired_token' })
  }, 60_000)
})
