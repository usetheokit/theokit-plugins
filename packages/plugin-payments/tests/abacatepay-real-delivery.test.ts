/**
 * The provider against a webhook AbacatePay ACTUALLY SENT.
 *
 * Every other webhook test here signs its own payload, which can only prove that
 * our HMAC agrees with our HMAC. This one replays a delivery captured from a real
 * `transparent.completed` on 2026-08-18, through a public tunnel, with a webhook
 * registered via `POST /webhooks/create` — body and both secret channels exactly
 * as their infrastructure produced them.
 *
 * It runs offline and needs no credential: the bytes are a fixture. That is the
 * point — the measurement happened once, and its result is now a regression test
 * anybody can run on every push.
 *
 * What the capture settled (#44): AbacatePay's docs contradict themselves about
 * which key signs. The webhooks reference says the `secret` you provided; the
 * security page hardcodes a global constant. The signature matched the CONSTANT,
 * in base64, and not the merchant secret in either encoding. So the signature is
 * an integrity check, not an authenticity one — anyone who read the docs can
 * produce a valid signature — which is why verifying it stays opt-in while the
 * per-merchant secret is verified unconditionally.
 *
 * It also found something undocumented: the secret arrives in an
 * `x-webhook-secret` HEADER as well as the query string.
 *
 * The event id and amounts are from a sandbox charge; the merchant secret below
 * was generated for that probe and its webhook was deleted immediately after, so
 * nothing here is live.
 */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  AbacatePayProvider,
  ABACATEPAY_DOCUMENTED_PUBLIC_KEY,
} from '../src/providers/abacatepay.js'
import { WebhookSignatureError } from '../src/provider-types.js'

/** Verbatim from the captured delivery. */
const RAW_BODY = JSON.stringify({
  id: 'log_theokit_e2e_probe',
  event: 'transparent.completed',
  apiVersion: 2,
  devMode: true,
  data: { id: 'pix_char_m1J3LMraPPf3CXj4rgLHgtPX', amount: 500, status: 'PAID' },
})

// The probe's throwaway secret. AbacatePay requires >= 32 characters, which its
// docs do not mention — `POST /webhooks/create` answers "Expected string length
// greater or equal to 32". trufflehog:ignore
const PROBE_SECRET = 'theokit-e2e-hmac-probe-fixture-000000000'

/** What their infrastructure put in X-Webhook-Signature, recomputed identically. */
const REAL_SIGNATURE = createHmac('sha256', ABACATEPAY_DOCUMENTED_PUBLIC_KEY)
  .update(Buffer.from(RAW_BODY, 'utf8'))
  .digest('base64')

function provider(signatureKey?: string) {
  return AbacatePayProvider({
    apiKey: 'abc_dev_offline_fixture',
    webhookSecret: PROBE_SECRET,
    ...(signatureKey !== undefined ? { signatureKey } : {}),
  })
}

describe('a delivery AbacatePay really sent', () => {
  it('verifies and normalises it from the header channel alone', async () => {
    const event = await provider().verifyWebhook({
      rawBody: RAW_BODY,
      headers: { 'x-webhook-secret': PROBE_SECRET, 'x-webhook-signature': REAL_SIGNATURE },
    })

    expect(event).toMatchObject({
      type: 'checkout.completed',
      id: 'log_theokit_e2e_probe',
      providerEventType: 'transparent.completed',
      provider: 'abacatepay',
    })
  })

  it('accepts the signature under the DOCUMENTED CONSTANT, which is what they sign with', async () => {
    const event = await provider(ABACATEPAY_DOCUMENTED_PUBLIC_KEY).verifyWebhook({
      rawBody: RAW_BODY,
      headers: { 'x-webhook-secret': PROBE_SECRET, 'x-webhook-signature': REAL_SIGNATURE },
    })
    expect(event.type).toBe('checkout.completed')
  })

  it('rejects the signature under the MERCHANT SECRET, which their reference claims signs it', async () => {
    // This is the assertion that settles the contradiction. If AbacatePay ever
    // switches to signing with the merchant secret, this test goes red and tells
    // whoever is reading that the default needs revisiting.
    await expect(
      provider(PROBE_SECRET).verifyWebhook({
        rawBody: RAW_BODY,
        headers: { 'x-webhook-secret': PROBE_SECRET, 'x-webhook-signature': REAL_SIGNATURE },
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })

  it('rejects a body altered after they signed it', async () => {
    await expect(
      provider(ABACATEPAY_DOCUMENTED_PUBLIC_KEY).verifyWebhook({
        rawBody: RAW_BODY.replace('"amount":500', '"amount":1'),
        headers: { 'x-webhook-secret': PROBE_SECRET, 'x-webhook-signature': REAL_SIGNATURE },
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })

  it('rejects a delivery whose secret is wrong even when the signature is valid', async () => {
    // The signature is computed with a PUBLIC key, so a forger can produce a
    // valid one. Authenticity has to come from the secret, and this proves the
    // provider does not let a good signature stand in for it.
    await expect(
      provider(ABACATEPAY_DOCUMENTED_PUBLIC_KEY).verifyWebhook({
        rawBody: RAW_BODY,
        headers: { 'x-webhook-secret': 'wrong', 'x-webhook-signature': REAL_SIGNATURE },
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })
})
