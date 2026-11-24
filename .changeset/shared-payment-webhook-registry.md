---
'@theokit/plugin-payments': patch
---

The Stripe and provider-neutral webhook paths now share one handler registry and one Stripe signature verifier. No public API or behaviour change; both idempotency keys are unchanged.
