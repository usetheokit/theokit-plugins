/**
 * The seam between the two packages that were designed to plug into each other.
 *
 * `sendMagicLink()` here exists to satisfy the `sendEmail` port that
 * `@theokit/auth-magic-link` declares. Both sides are well covered on their own —
 * and both sides were covered against their OWN idea of the other. The only
 * assertion about compatibility lived in this package and read
 * "returns a SendMagicLinkFn-compatible async function", checked against this
 * package's own type. Nothing ever handed the real adapter to the real port.
 *
 * The failure that hides in a gap like this is total: the user gets an email with
 * a link that does not sign them in, and every unit test stays green. So this
 * suite drives the whole path — `startSignIn` mints and persists the token,
 * `sendMagicLink` renders and "sends" it, the URL is recovered from the HTML the
 * way a mail client would, and `handleCallback` is asked to accept it.
 *
 * The test lives in the ADAPTER's package, not the port's: the port must not need
 * to know who implements it (DIP), so `auth-magic-link` stays free of any
 * reference to this one.
 */

import type { IncomingMessage } from 'node:http'

import { createMemoryStore, magicLink } from '@theokit/auth-magic-link'
import { describe, expect, it } from 'vitest'

import { sendMagicLink } from '../../src/magic-link.js'
import type { EmailMessage, EmailProvider, SendResult } from '../../src/types.js'

/** Captures what was "sent" so the HTML can be read back. */
function capturingProvider(): { provider: EmailProvider; sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  const provider: EmailProvider = {
    name: 'capture',
    send(message: EmailMessage): Promise<SendResult> {
      sent.push(message)
      return Promise.resolve({ id: `captured-${sent.length}`, provider: 'capture' })
    },
  }
  return { provider, sent }
}

/** A POST whose body carries the email, as `defaultResolveEmail` expects. */
function signInRequest(email: string): IncomingMessage {
  const body = JSON.stringify({ email })
  function* chunks() {
    yield Buffer.from(body, 'utf8')
  }
  const req = chunks() as unknown as IncomingMessage
  Object.assign(req, {
    method: 'POST',
    url: '/auth/magic-link/start',
    headers: { host: 'app.example.com', 'content-type': 'application/json' },
  })
  return req
}

/** The callback GET a mail client's click would produce for `url`. */
function callbackRequest(url: string): IncomingMessage {
  const parsed = new URL(url)
  return {
    method: 'GET',
    url: `${parsed.pathname}${parsed.search}`,
    headers: { host: parsed.host },
  } as unknown as IncomingMessage
}

/**
 * Recover the href a mail client would follow.
 *
 * The template writes the URL through `escapeAttr`, so `&` arrives as `&amp;` —
 * correct HTML, and a browser un-escapes it before requesting. Reading the raw
 * attribute here instead would test a string no client ever fetches.
 */
function hrefFromHtml(html: string): string {
  const href = /<a[^>]+href="([^"]+)"/.exec(html)?.[1]
  if (href === undefined) throw new Error(`no anchor href in the rendered email:\n${html}`)
  return href
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

/** The one message the run captured, narrowed once so each test can read it. */
function onlyMessage(sent: readonly EmailMessage[]): EmailMessage {
  expect(sent, 'the adapter never reached the provider').toHaveLength(1)
  const message = sent[0]
  if (message === undefined) throw new Error('unreachable: length asserted above')
  return message
}

function wire(callbackBaseUrl: string) {
  const { provider, sent } = capturingProvider()
  const store = createMemoryStore()
  const provider_ = magicLink({
    store,
    callbackBaseUrl,
    // The whole point: the adapter this package ships, handed to the real port.
    sendEmail: sendMagicLink(provider, { from: 'no-reply@example.com', appName: 'Acme' }),
  })
  return { auth: provider_, sent, store }
}

describe('the adapter this package ships satisfies the port auth-magic-link declares', () => {
  it('a link rendered into the email signs the user in', async () => {
    const { auth, sent } = wire('https://app.example.com')

    await auth.startSignIn(signInRequest('user@example.com'))

    const html = onlyMessage(sent).html
    expect(html, 'the default template rendered an empty HTML body').not.toBe('')

    const clicked = hrefFromHtml(html)
    const result = await auth.handleCallback(callbackRequest(clicked), {} as never)

    expect(result.profile.email).toBe('user@example.com')
  })

  it('the plain-text body carries a link that works too', async () => {
    // Mail clients that render text-only are not a rare edge: the text part is
    // the fallback the template promises, so it has to be usable.
    const { auth, sent } = wire('https://app.example.com')
    await auth.startSignIn(signInRequest('text-reader@example.com'))

    const text = onlyMessage(sent).text
    expect(typeof text, 'the default template renders a text part').toBe('string')
    const url = /(https?:\/\/\S+)/.exec(text as string)?.[1]
    expect(url, 'no URL in the text body').toBeDefined()

    const result = await auth.handleCallback(callbackRequest(url as string), {} as never)
    expect(result.profile.email).toBe('text-reader@example.com')
  })

  it('survives a callback base that already carries a query string', async () => {
    // This is where escaping stops being academic: a second parameter puts a real
    // `&` in the href, which the template escapes to `&amp;`. If anything on the
    // path mishandled it, the token would arrive truncated or renamed.
    const { auth, sent } = wire('https://app.example.com/app?tenant=acme')
    await auth.startSignIn(signInRequest('tenant@example.com'))

    const clicked = hrefFromHtml(onlyMessage(sent).html)
    expect(clicked, 'the base query string was dropped').not.toContain('&amp;')

    const result = await auth.handleCallback(callbackRequest(clicked), {} as never)
    expect(result.profile.email).toBe('tenant@example.com')
  })

  it('the emailed link is single-use, end to end', async () => {
    // Each side proves single-use against its own store. This proves it survives
    // the round trip through the email, which is the only path a user takes.
    const { auth, sent } = wire('https://app.example.com')
    await auth.startSignIn(signInRequest('once@example.com'))
    const clicked = hrefFromHtml(onlyMessage(sent).html)

    await auth.handleCallback(callbackRequest(clicked), {} as never)

    // Assert the typed error and its code, not the prose: the message is wording
    // and may be improved, the code is the contract a caller branches on
    // (`rules/error-handling.md` § 2).
    await expect(auth.handleCallback(callbackRequest(clicked), {} as never)).rejects.toMatchObject({
      name: 'MagicLinkAuthError',
      code: 'invalid_or_expired_token',
    })
  })
})
