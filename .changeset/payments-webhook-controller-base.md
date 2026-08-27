---
'@theokit/plugin-payments': minor
---

The Stripe webhook endpoint as a controller your app extends, instead of a function you wire and translate by hand.

`StripeWebhookControllerBase` (new, from `@theokit/plugin-payments/server`) declares the `POST` verb and carries the two things that were previously yours to get right:

- **The result → status mapping.** `processWebhook` already decides what happened; the statuses it should map to were documentation, so every consumer re-typed them. A consumer who answered 200 to `handler_error` silently told Stripe to stop retrying a delivery that never succeeded.
- **The raw body.** Stripe signs the exact bytes it sent, so the body is read once as text and never parsed. A controller that took a validated body would hand verification a re-serialised object whose signature no longer matches — and the usual next step is someone disabling verification.

It binds no URL and no access decision. Both stay yours, and the webhook endpoint **must** be declared public and CSRF-exempt on your subclass: Stripe carries no session, and its authentication is the signature this class verifies.

`processWebhook` is unchanged and still supported. `@theokit/http` is an OPTIONAL peer, loaded only by the new `./server` entry.
