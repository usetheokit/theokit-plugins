---
'@theokit/plugin-payments': minor
---

Export `STRIPE_DECORATION_KEY` from `@theokit/plugin-payments/stripe`, so the key `ctx.stripe` is published under can be imported instead of retyped. The key's value is unchanged — `ctx.stripe` still works exactly as before, and nothing breaks.

Retyping it is what this removes: a mistyped key is not an error, it is `undefined` at request time, in a handler that reads correctly. It also makes a future rename a one-line change for you rather than a search-and-replace — the name is a vendor noun, which a plugin key should not be, and changing it will be a breaking release of its own.
