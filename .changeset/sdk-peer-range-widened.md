---
'@theokit/auth-github': patch
'@theokit/auth-google': patch
'@theokit/auth-magic-link': patch
'@theokit/plugin-copilot': patch
---

Widen the `@theokit/sdk` peer range from `^2.18.0` to `>=2.18.0`. These packages work with the current sdk major and the old range said otherwise.

If you use `create-theokit`, your app pins `@theokit/sdk@^4`. Installing these packages alongside it produced a peer mismatch that **pnpm did not warn about** — you got a combination nobody had declared support for and were not told.

What the widening rests on, measured against `@theokit/sdk@4.53.1` rather than assumed:

- the three auth packages import **types only** (`AuthProvider`, `AuthResult`, `OAuthTransaction`), erased at compile time. No sdk code runs in them; the helpers they execute come from `theokit/server/auth`.
- `plugin-copilot` is the one with a real runtime dependency, and each function it calls was exercised: `Budget.create`, `Budget.get`, `remainingIn`, `preflightCheck`, `chargeAndCheckThresholds`, `computeCost`.

Unrelated to this change and worth knowing if you use the sdk's auth orchestrator: `Auth.create(...)` cannot complete an OAuth sign-in on any published sdk version — the transaction cookie is written under one name and read under another. Reported as usetheokit/theokit-sdk#376. Composing providers through `route()` is unaffected and works.
