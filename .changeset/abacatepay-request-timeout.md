---
'@theokit/plugin-payments': minor
---

Bound AbacatePay API calls with a new `timeoutMs` option (default 10000 ms). A timeout rejects with `PaymentProviderError` code `upstream_timeout`.
