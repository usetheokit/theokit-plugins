---
'@theokit/auth-github': minor
'@theokit/auth-google': minor
'@theokit/auth-magic-link': minor
---

These providers now accept a Web `Request` wherever they accepted Node's `IncomingMessage`, which is what makes them usable inside a TheoKit app at all.

The SDK's `AuthProvider` interface types the callback parameter as `IncomingMessage`, and TheoKit's `route()` handler hands a Web `Request` — the runtime converts before dispatch, so the Node objects never reach a handler. Wiring any of these into a TheoKit route did not compile, and nothing in the test suites covered that composition. `handleCallback` (all three) and `startSignIn` / the `resolveEmail` option (magic-link) now take `IncomingMessage | Request`, so the whole flow can stay on the Web shapes TheoKit gives you: drive the provider directly and create the session with `createSessionManagerWeb` from `theokit/server/auth`.

`@theokit/auth-magic-link` reads the request body, and the Web path reads it in capped chunks rather than through `Request.text()` — the 16 KB DoS cap that has always guarded the Node path now guards this one too.

The `defineAuth` orchestrator is unchanged and still Node-shaped; it is the other way in, for apps running their own Node server.
