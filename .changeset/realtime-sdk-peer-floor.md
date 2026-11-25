---
'@theokit/plugin-realtime': patch
---

The `@theokit/sdk` peer floor is now `>=5.12.1`. Earlier sdk releases (such as 4.54.0) have no `defineSubscription` in `@theokit/sdk/subscription`, which the plugin and its README use.
