---
"@theokit/plugin-email": patch
---

`defineEmailProvider` now validates its argument and fails fast with a typed `TypeError`
when the provider is null/not-an-object, has a missing/empty `name`, or a non-function
`send` — a malformed provider crashes at wiring time instead of on the first `send()`.
Mirrors `defineRealtimeProvider`. Valid providers are unaffected (still returned unchanged).
