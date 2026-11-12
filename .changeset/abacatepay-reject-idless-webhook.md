---
'@theokit/plugin-payments': patch
---

Refuse an AbacatePay webhook without a usable `id` as `malformed_webhook_body` instead of deduplicating it against every other id-less event, and make `runIdempotently` reject an empty or suffix-less event id.
