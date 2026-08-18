---
'@theokit/plugin-payments': patch
---

The AbacatePay webhook HMAC contradiction is settled by a real delivery, and the secret has an undocumented second channel (#44).

Their docs disagreed about which key signs: the webhooks reference says the `secret` you provided, the security page hardcodes a global constant. A public tunnel plus `POST /webhooks/create` made it possible to receive a genuine `transparent.completed` and compare the `X-Webhook-Signature` **they sent** against both candidates.

It matches `base64(HMAC-SHA256(rawBody, THE_PUBLISHED_CONSTANT))`, and not the merchant secret in base64 or hex. So the signature is computed with a key anyone can read in their own documentation: it proves the body was not altered in transit and **not** that AbacatePay sent it. Verifying it therefore stays opt-in — enabling it by default would add a check that looks like authentication and is not.

**The security-relevant find: the per-merchant secret also arrives in an `x-webhook-secret` header**, which is documented nowhere. The provider now prefers it over the query string, because a secret in a URL reaches proxy logs, browser history and Referer. `verifyWebhook` accepts the header, the url, or both, and refuses when neither carries the secret — previously it required the url.

The capture is now an offline regression fixture (`tests/abacatepay-real-delivery.test.ts`) that runs on every push with no credential. One of its assertions states that the signature does **not** verify under the merchant secret: if AbacatePay switches, that test goes red and says the default needs revisiting, instead of the change passing unnoticed.

Two more things their docs omit, found on the way: `POST /webhooks/create` requires a `secret` of **at least 32 characters**, and `POST /webhooks/delete` needs more than the "Leitura e escrita" scope — it answers "Insufficient permissions".
