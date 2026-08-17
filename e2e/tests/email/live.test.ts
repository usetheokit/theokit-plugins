/**
 * Email — live tests against the real Resend API.
 *
 * `packages/plugin-email/tests/resend-provider.test.ts` proves this provider
 * behaves against a fake client, and a fake agrees with whoever wrote it. What
 * it cannot prove is the thing that actually breaks: that the shape we POST is
 * still the shape Resend accepts, and that a real refusal arrives in the form
 * `ResendProvider` claims to translate.
 *
 * Three contracts are asserted here, and nothing else:
 *
 *   auth        the key reaches Resend and is accepted
 *   payload     our built payload is accepted and comes back with an id
 *   errors      a real rejection surfaces as EmailSendError, not as a raw throw
 *
 * The suite does NOT re-test template rendering or header building over the
 * wire; those are deterministic and already covered against the fake.
 *
 * Every message carries a run marker, and nothing is deleted: the recipient is a
 * throwaway mailbox, and a delete racing a slow delivery would make failures
 * harder to read than the litter is worth. Search `theokit-e2e`.
 */

import { EmailSendError, ResendProvider } from '@theokit/plugin-email'
import { expect, it } from 'vitest'

import { required, runMarker } from '../../src/credentials.js'
import { describeLive } from '../../src/harness.js'
import { serviceById } from '../../src/services.js'

const EMAIL = serviceById('email')

function provider() {
  return ResendProvider({ apiKey: required('RESEND_API_KEY') })
}

function message(marker: string, overrides: Record<string, unknown> = {}) {
  return {
    to: required('EMAIL_TEST_RECIPIENT'),
    from: required('RESEND_FROM_ADDRESS'),
    subject: `${marker} live probe`,
    html: `<p>${marker}</p>`,
    text: marker,
    ...overrides,
  }
}

describeLive(EMAIL, 'outbound', () => {
  it('sends a message Resend accepts, and returns the provider id', async () => {
    const marker = runMarker()
    const result = await provider().send(message(marker))

    expect(result.provider).toBe('resend')
    // Resend ids are `re_`-prefixed. Asserting the prefix rather than just
    // "truthy" is what would catch a response shape change that still returns
    // *something* — the failure mode a fake can never reproduce.
    expect(result.id).toMatch(/^re_/)
  }, 60_000)

  it('accepts an idempotency key and does not create a second message for it', async () => {
    // ResendProvider maps `idempotencyKey` to the `Idempotency-Key` header, and
    // Resend's documented behaviour is to return the SAME id for a repeat. That
    // round trip is the only way to know the header is still the one they read:
    // a fake would happily accept a header name nobody honours.
    const marker = runMarker()
    const key = `${marker}-idem`

    const first = await provider().send(message(marker, { idempotencyKey: key }))
    const second = await provider().send(message(marker, { idempotencyKey: key }))

    expect(second.id).toBe(first.id)
  }, 90_000)
})

describeLive(
  EMAIL,
  'error mapping',
  () => {
    it('raises EmailSendError when Resend rejects the sender address', async () => {
      // An unverified from-address is the rejection every consumer hits first,
      // and it is refused synchronously — unlike a bad recipient domain, which
      // bounces later and asynchronously, and which no test can wait for.
      const unverified = 'e2e-not-verified@example.invalid'
      const attempt = provider().send(message(runMarker(), { from: unverified }))

      await expect(attempt).rejects.toBeInstanceOf(EmailSendError)
    }, 60_000)

    it('raises EmailSendError, not a bare fetch error, on a key the API rejects', async () => {
      // The contract is that auth failure arrives as our typed error. If the SDK
      // ever throws before the provider's try/catch, this is what notices.
      const bad = ResendProvider({ apiKey: 're_00000000_notarealkeyatall' })
      const attempt = bad.send(message(runMarker()))

      await expect(attempt).rejects.toBeInstanceOf(EmailSendError)
    }, 60_000)
  },
  // Rejection paths need the key and the from-address, but never deliver, so the
  // recipient is not required for them to be meaningful.
  { sends: true },
)
