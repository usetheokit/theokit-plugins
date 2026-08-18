/**
 * Magic-link — the link taken from a message that was RECEIVED, over a real socket.
 *
 * The other two suites each stop one step short of a user's journey:
 *
 *   magic-link-seam.test.ts   real port + real adapter, but a capturing provider —
 *                             nothing is transmitted
 *   magic-link-live.test.ts   real Resend API accepts the real template — but the link
 *                             asserted is the one WE handed over, because
 *                             `EMAIL_TEST_RECIPIENT` is Resend's sandbox address (no
 *                             mailbox) and the key is send-restricted (`GET /emails`
 *                             answers 401 restricted_api_key)
 *
 * This one closes the gap without asking anyone for a credential: it starts a real SMTP
 * server, sends the magic-link message to it over TCP through nodemailer, parses the MIME
 * that ARRIVED with mailparser, and pulls the link out of the received body. The token
 * then has to still sign the user in.
 *
 * ── WHY THIS IS WORTH ITS OWN FILE, AND WHAT IT DOES NOT PROVE ──────────────────
 *
 * It exercises a transport this package does not ship. `ResendProvider` posts JSON, so
 * MIME never enters the Resend path; the provider below is written here, for the test,
 * against the public `EmailProvider` contract that `defineEmailProvider` exists to let
 * consumers implement. So this is NOT proof that Resend delivered anything — that stays
 * with the live suite and with B-004.
 *
 * What it IS proof of is the failure mode nothing else here can reach. A magic-link URL
 * runs past 76 characters (a 32-byte URL-safe token is ~43 on its own), and
 * quoted-printable breaks lines at 76 with a soft `=\r\n`. A link that arrives split
 * across two lines is unusable, and every JSON-transport test in this repo would stay
 * green through it. Any consumer who wires SMTP — the obvious choice for self-hosting —
 * takes that path.
 */

import { createMemoryStore, magicLink } from '@theokit/auth-magic-link'
import { sendMagicLink } from '@theokit/plugin-email'
import type { EmailMessage, EmailProvider, SendResult } from '@theokit/plugin-email'
import { simpleParser, type ParsedMail } from 'mailparser'
import { createTransport } from 'nodemailer'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AddressInfo } from 'node:net'
import type { IncomingMessage } from 'node:http'

/** `mail.to` may be one AddressObject or a list; read the text off whichever arrived. */
function addressText(field: ParsedMail['to'] | ParsedMail['from']): string {
  if (field === undefined) return ''
  return Array.isArray(field) ? field.map((a) => a.text).join(', ') : field.text
}

/** One received message: the raw bytes off the wire, and the parse of them. */
interface Delivery {
  readonly raw: string
  readonly mail: ParsedMail
}

let server: SMTPServer
let port: number
const delivered: Delivery[] = []

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    // Read the stream to the end and keep the bytes. Parsing here rather than in the
    // test keeps the assertion honest: what is parsed is what the socket carried.
    onData(stream, _session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        simpleParser(raw)
          .then((mail) => {
            delivered.push({ raw, mail })
            callback()
          })
          .catch(callback)
      })
    },
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      port = (server.server.address() as AddressInfo).port
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/**
 * An SMTP-backed `EmailProvider`, written against the same public contract
 * `defineEmailProvider` documents for consumers. Nothing here is mocked: nodemailer
 * builds real MIME and speaks real SMTP to the server above.
 */
function smtpProvider(): EmailProvider {
  const transport = createTransport({ host: '127.0.0.1', port, secure: false, tls: { rejectUnauthorized: false } })
  return {
    name: 'smtp',
    async send(message: EmailMessage): Promise<SendResult> {
      const info = await transport.sendMail({
        // `EmailMessage.to` is `string | readonly string[]`; nodemailer wants a mutable
        // array. Copying is the honest conversion — casting the readonly away would let a
        // future mutation of the caller's array pass unnoticed.
        to: typeof message.to === 'string' ? message.to : [...message.to],
        from: message.from,
        subject: message.subject,
        html: message.html,
        text: message.text,
      })
      return { id: info.messageId, provider: 'smtp' }
    },
  }
}

function signInRequest(email: string): IncomingMessage {
  const body = JSON.stringify({ email })
  function* chunks() {
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

/**
 * A base long enough that quoted-printable MUST break a line inside the token.
 *
 * Measured: with a short base the URL lands on a 51-character line and no break falls
 * inside it — the test would pass without ever exercising the encoding. With this base
 * the raw message carries `…token=3DFwjS…BvU1=` at column 76 and the rest on the next
 * line, which is the case a naive extraction gets wrong.
 */
const LONG_BASE =
  'https://app.usetheo.dev/tenant/acme-corporation-holdings/workspace/engineering-team'

function wire(callbackBaseUrl = 'https://app.usetheo.dev') {
  return magicLink({
    store: createMemoryStore(),
    callbackBaseUrl,
    sendEmail: sendMagicLink(smtpProvider(), {
      from: 'no-reply@usetheo.dev',
      appName: 'TheoKit',
    }),
  })
}

function onlyDelivery(): Delivery {
  expect(delivered, 'nothing arrived at the SMTP server').toHaveLength(1)
  const one = delivered[0]
  if (one === undefined) throw new Error('unreachable: length asserted above')
  return one
}

/** The href a mail client would follow, taken from the RECEIVED html. */
function hrefFromReceived(mail: ParsedMail): string {
  const html = mail.html
  expect(typeof html, 'the delivered message carried no html part').toBe('string')
  const href = /<a[^>]+href="([^"]+)"/.exec(html as string)?.[1]
  if (href === undefined) throw new Error(`no anchor href in the delivered html:\n${html}`)
  // mailparser has already undone the transfer encoding; `&amp;` is HTML, and a browser
  // un-escapes it before requesting.
  return href
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

describe('the link in the message that arrived', () => {
  beforeAll(async () => {
    delivered.length = 0
    await wire().startSignIn(signInRequest('recipient@example.test'))
  })

  it('arrived at all, addressed to the recipient, with both bodies', () => {
    const { mail } = onlyDelivery()
    expect(addressText(mail.to)).toBe('recipient@example.test')
    expect(addressText(mail.from)).toContain('no-reply@usetheo.dev')
    expect(mail.subject).toContain('TheoKit')
    expect(typeof mail.html, 'no html part survived delivery').toBe('string')
    expect(mail.text, 'no text part survived delivery').toBeTruthy()
  })

  it('was quoted-printable encoded on the wire, not sent as-is', () => {
    // Guards the premise of the next test. A transport that skipped the encoding would
    // make every assertion below pass for the wrong reason.
    const { raw } = onlyDelivery()
    expect(raw, 'nothing declared a transfer encoding').toMatch(
      /Content-Transfer-Encoding:\s*quoted-printable/i,
    )
    // `=` inside the URL arrives as `=3D`, so the link genuinely went through the codec.
    expect(raw, 'the URL was not encoded at all').toMatch(/token=3D/)
  })

  it('survives a soft line break landing inside the token', async () => {
    // The assertion this whole file exists for, and the one that needed a long base URL to
    // become real: with a short one the link lands on a 51-character line, no break falls
    // inside it, and the test would pass without exercising the codec at all.
    const auth = wire(LONG_BASE)
    delivered.length = 0
    await auth.startSignIn(signInRequest('longurl@example.test'))

    const { raw, mail } = onlyDelivery()

    // First prove the hard case actually happened: a 76-column line ending in a soft
    // break, carrying part of the token. Without this the test claims a failure mode it
    // never reached.
    const split = raw
      .split(/\r?\n/)
      .some((line) => line.endsWith('=') && line.includes('token=3D') && line.length === 76)
    expect(split, 'no soft break landed inside the token — the case was not exercised').toBe(true)

    // Then prove it round-trips: the href a client follows is whole, and the token in it
    // is the one the store will accept.
    const href = hrefFromReceived(mail)
    expect(href, 'a soft line break survived into the link').not.toMatch(/=\r?\n/)
    expect(href, 'the link lost its whitespace integrity').not.toMatch(/\s/)
    expect(href.length, 'the link arrived truncated').toBeGreaterThan(80)

    const result = await auth.handleCallback(callbackRequest(href), {} as never)
    expect(result.profile.email).toBe('longurl@example.test')
  })

  it('signs the user in — the delivered token is the one the store holds', async () => {
    // This is the claim the other two suites cannot make: the token came out of a message
    // that travelled over a socket and was parsed back from its wire format.
    const auth = wire()
    delivered.length = 0
    await auth.startSignIn(signInRequest('roundtrip@example.test'))

    const href = hrefFromReceived(onlyDelivery().mail)
    const result = await auth.handleCallback(callbackRequest(href), {} as never)

    expect(result.profile.email).toBe('roundtrip@example.test')
  })

  it('is single-use after arriving', async () => {
    const auth = wire()
    delivered.length = 0
    await auth.startSignIn(signInRequest('once@example.test'))

    const href = hrefFromReceived(onlyDelivery().mail)
    await auth.handleCallback(callbackRequest(href), {} as never)

    await expect(auth.handleCallback(callbackRequest(href), {} as never)).rejects.toMatchObject({
      name: 'MagicLinkAuthError',
      code: 'invalid_or_expired_token',
    })
  })

  it('the text part carries a usable link too', async () => {
    // Mail clients that render text-only are the fallback the template promises, and the
    // text part is where a long URL is most likely to be mangled: no markup protects it.
    const auth = wire()
    delivered.length = 0
    await auth.startSignIn(signInRequest('textonly@example.test'))

    const text = onlyDelivery().mail.text ?? ''
    const url = /(https?:\/\/\S+)/.exec(text)?.[1]
    expect(url, 'no URL in the delivered text part').toBeDefined()
    expect(url, 'the text link arrived broken').not.toMatch(/=$/)

    const result = await auth.handleCallback(callbackRequest(url as string), {} as never)
    expect(result.profile.email).toBe('textonly@example.test')
  })
})
