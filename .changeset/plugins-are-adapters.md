---
'@theokit/plugin-payments': minor
'@theokit/plugin-db-drizzle': minor
---

The plugins are TheoKit adapters now, and two of them stop typing against an API that does not exist (#42).

Measured across the eleven packages: **none** used the framework's plugin authoring API, and two declared a local `TheoPluginApp` describing methods `TheoApp` does not have — `registerRoute`/`hasRoute` in payments, `registerModule`/`registerCliCommand`/`registerDevtoolsTab`/`hasCliCommand` in db-drizzle. Both type-checked, because TypeScript is structural and the parameter was never used. The real contract is `{ addHook, decorateRequest }`, and `import type` is erased at build — so importing the real one costs nothing at runtime, which `plugin-voice` had been documenting two directories away.

**`@theokit/plugin-payments`** — `register()` publishes the gateways on `ctx.payments`, the `@InjectStripeClient` equivalent:

```ts
const result = await ctx.payments.handleWebhook(params.gateway, { rawBody, headers, url })
```

That surface is deliberately narrower than the plugin — `providers`, `provider(key)`, `handleWebhook`, and **not** `store` or `registry`. The narrowing buys a safety property rather than tidiness: a handler holding `store` can claim or release an event id outside the dispatcher and defeat idempotency; one holding `registry` can rewire routing mid-request.

`stripePayments()` publishes the client on `ctx.stripe` and resolves it **at boot**, so a missing `STRIPE_SECRET_KEY` crashes on startup instead of 500-ing while somebody is paying.

**`@theokit/plugin-db-drizzle`** — `register()` used to call the invented methods behind `if (app.registerCliCommand)` guards, so seven documented CLI verbs and a devtools tab were a silent no-op for several releases (#43). The dead branches are gone and `register()` is now empty *by decision*, with the reason stated: this plugin has no runtime surface to publish.

`buildDbCommands` and `buildDevtoolsTab` are **exported** — they were reachable only from a `register()` calling a nonexistent API and from their own ~30 assertions, so exporting them un-hides surface that already existed and was already tested. The README no longer promises `theokit db <verb>`, which the `theokit` CLI (build / dev / doctor / start) has never had; it shows the script you wire yourself, and that example was executed before shipping.

**BREAKING** in both: `TheoPluginApp` is gone. `register(app)` now takes the framework's `TheoApp`. Anything calling it with a hand-rolled object needs `{ addHook, decorateRequest }` — which is what the plugin runner has always passed.
