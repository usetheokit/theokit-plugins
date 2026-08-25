---
'@theokit/plugin-payments': minor
---

Narrow the `stripe` peer to `^14.8.0` — the range the package can actually compile against.

It declared `>=14.0.0` while npm serves `22.5.0`, so it claimed eight majors it cannot support. `src/options.ts` derives its public API-version type from the installed SDK and then assigns stripe 14's literal to it:

```ts
export type StripeApiVersion = Stripe.LatestApiVersion
const DEFAULT_API_VERSION: StripeApiVersion = '2023-10-16'
```

That literal changes with every major — `2024-04-10` in 15, `2024-06-20` in 16, `2026-07-29.dahlia` in 22 — so those two lines do not typecheck against anything above 14. And the runtime guard added in #210 accepts `'2023-10-16'` alone, so a consumer on a newer SDK either gets a `StripeApiVersionError` at client construction or is silently pinned to an API version three years older than their SDK's types describe.

Nothing about which stripe versions work has changed. What changed is that the manifest now says so, at install time, instead of leaving it to be discovered at runtime.

Supporting a modern stripe is separate work: it means deciding whether the plugin pins an API version at all, and the accepted-version set is a security surface, not a range to widen casually.
