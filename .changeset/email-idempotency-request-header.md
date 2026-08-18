---
'@theokit/plugin-email': patch
---

Fix `idempotencyKey`: it never reached Resend's deduplication.

The key was written into `payload.headers`, which are MIME headers of the message. Resend deduplicates on the `Idempotency-Key` **HTTP request header**, which the SDK exposes only through the second argument of `emails.send` (`CreateEmailRequestOptions`). So the key travelled as a decorative message header and Resend never deduplicated anything — anyone relying on it to make a retry safe (webhook redelivery, queue reprocessing) **sent the email twice**, while the README stated it worked.

Now passed as `send(payload, { idempotencyKey })`. Custom `headers` still travel with the message, untouched.

Found by the new live e2e suite on its first real run: the same key twice returned two different message ids. The unit test had asserted `payload.headers['Idempotency-Key']` under the name "maps to Idempotency-Key HTTP header" — both cannot be true, so it passed while the behaviour was wrong. Verified against the real API: two sends with one key now return the same id.

No API change for consumers: `EmailMessage.idempotencyKey` is the same field, it just works now.
