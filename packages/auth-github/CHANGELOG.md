# Changelog

## 0.5.1

### Patch Changes

- 54313aa: The route examples name the directory that produces the URL they claim.

  All three READMEs showed `// server/routes/api/auth/<provider>/start.ts`. TheoKit already serves `server/routes/` under `/api`, so that file answers at `/api/api/auth/<provider>/start` — a reader who registered `/api/auth/<provider>/callback` with GitHub or Google got a 404 on the redirect, and nothing pointed back at the extra directory.

  The same path also produced `client.api.auth.<provider>.start.get()` in the generated typed client, with a redundant segment that reads as a typo.

  Found by building a consumer app against these examples. `theokit` now refuses the directory at scan time rather than doubling it silently, so following the old examples fails at build instead of at the identity provider's redirect.

## 0.5.0

### Minor Changes

- 24dfe32: Requires `@theokit/sdk@4.54.0` or newer, and the auth READMEs name the API that exists.

  All three auth READMEs opened with `import { defineAuth } from '@theokit/sdk/server/auth'`. That function shipped in sdk 2.x and is gone from 4.x, which is what npm serves — so a reader copying the first example imported something that does not exist. The orchestrator is now `Auth.create`, and the options are unchanged.

  Nothing here caught it because these packages tested against `@theokit/sdk@^2.18.0` — a caret on a 2.x version, so two majors behind what a consumer installs. The doc gate that type-checks README examples was checking them against a version nobody has. It now checks against 4.54.0, and that is what surfaced this.

  `@theokit/plugin-copilot` gains a fix of its own: `CopilotAgentLike` could not be satisfied by any real agent. It declared `streamObject<T>(opts: { schema: unknown })` and promised `DeepPartial<T>` out — a `T` no parameter determined — so `@theokit/sdk`'s `Agent`, the only agent this ecosystem ships, was not assignable while the README invited exactly that wiring. It is now parameterised on the schema, as the SDK does.

  The same package's `CopilotFrame` also mirrors every `RealtimeFrame` variant again: `yjs-update` and `yjs-awareness` arrived upstream with collaborative editing and were never copied, which made `@theokit/plugin-realtime`'s provider — a declared peer — unassignable.

  If you are on `@theokit/sdk@2.x` or `3.x`, the previous release of these packages still installs.

## 0.4.0

### Minor Changes

- a76d961: Requires `theokit@0.50.1` or newer, and the README examples now declare a route policy.

  TheoKit 0.50.0 made `.policy()` mandatory on every route: a route without one fails `theokit build`, so that "who may call this" is a decision somebody wrote rather than a default nobody read. The `route()` examples in four of these READMEs predated that and had no policy — a reader who copied one got a build failure from our own documentation.

  Every example now declares its policy and says why it is the right one. For the auth packages that is `public`, because a visitor arrives without a session and signing in is what gives them one; for the payments webhook it is `public` because the gateway holds no session of ours and the signature is the authentication.

  The peer floor moves from `>=0.48.7` to `>=0.50.1` for the same reason it moved in the tests: these packages are built, tested and documented against 0.50.1 and against nothing older. The previous range admitted versions nobody here verifies. If you are on `theokit@0.48.x`, the previous release of these packages still installs.

## 0.3.1

### Patch Changes

- 2b5779a: Widen the `@theokit/sdk` peer range from `^2.18.0` to `>=2.18.0`. These packages work with the current sdk major and the old range said otherwise.

  If you use `create-theokit`, your app pins `@theokit/sdk@^4`. Installing these packages alongside it produced a peer mismatch that **pnpm did not warn about** — you got a combination nobody had declared support for and were not told.

  What the widening rests on, measured against `@theokit/sdk@4.53.1` rather than assumed:
  - the three auth packages import **types only** (`AuthProvider`, `AuthResult`, `OAuthTransaction`), erased at compile time. No sdk code runs in them; the helpers they execute come from `theokit/server/auth`.
  - `plugin-copilot` is the one with a real runtime dependency, and each function it calls was exercised: `Budget.create`, `Budget.get`, `remainingIn`, `preflightCheck`, `chargeAndCheckThresholds`, `computeCost`.

  Unrelated to this change and worth knowing if you use the sdk's auth orchestrator: `Auth.create(...)` cannot complete an OAuth sign-in on any published sdk version — the transaction cookie is written under one name and read under another. Reported as usetheokit/theokit-sdk#376. Composing providers through `route()` is unaffected and works.

## 0.3.0

### Minor Changes

- f6de463: Framework peer ranges describe the version each package is built against.

  `@theokit/sdk` was declared `>=2.18.0` — unbounded — on the four packages that import it, while
  the published SDK is 4.53.1 and their devDependency pins `^2.18.0`. A consumer on the current SDK
  satisfied the peer, installed without a warning, and received code compiled two majors earlier.
  Narrowed to `^2.18.0`.

  `plugin-canvas` declared `@theokit/ui: ^1.1.0` while building against `^1.3.2`; narrowed to
  `^1.3.2`. No live break there — `DiffViewer` is exported from 1.1.0 — but the range promised
  versions nothing compiles against.

- f71f9bc: The `theokit` peer floor is `>=0.48.7`, the version these packages are actually built against.

  The declared floors ranged from `>=0.1.0-alpha.5` to `>=0.4.0-beta.0` while every one of these
  packages carries `theokit: ^0.48.7` as its devDependency. Those ranges span the framework's move
  from `defineRoute({...})`-style functions to builders, so they admitted versions the code does not
  compile against — and the failure would land in a consumer's build, pointing at our package.

  Two of the old floors were pre-release versions, which promised compatibility with a version the
  framework itself did not consider stable.

  Widening a floor again is welcome, and now has a price: a CI job that builds the package against
  the version being claimed. `check:manifests` fails when a peer floor drops below the
  devDependency the package is built with.

## 0.2.0

### Minor Changes

- 7adfdf7: These providers now accept a Web `Request` wherever they accepted Node's `IncomingMessage`, which is what makes them usable inside a TheoKit app at all.

  The SDK's `AuthProvider` interface types the callback parameter as `IncomingMessage`, and TheoKit's `route()` handler hands a Web `Request` — the runtime converts before dispatch, so the Node objects never reach a handler. Wiring any of these into a TheoKit route did not compile, and nothing in the test suites covered that composition. `handleCallback` (all three) and `startSignIn` / the `resolveEmail` option (magic-link) now take `IncomingMessage | Request`, so the whole flow can stay on the Web shapes TheoKit gives you: drive the provider directly and create the session with `createSessionManagerWeb` from `theokit/server/auth`.

  `@theokit/auth-magic-link` reads the request body, and the Web path reads it in capped chunks rather than through `Request.text()` — the 16 KB DoS cap that has always guarded the Node path now guards this one too.

  The `defineAuth` orchestrator is unchanged and still Node-shaped; it is the other way in, for apps running their own Node server.

### Patch Changes

- 03b1b5d: Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

  Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

  Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.

## 0.1.2

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.

## 0.1.1

### Patch Changes

- 647a6c3: Surface a failed `/user/emails` fetch instead of silently returning a null-email identity (#203). When the `user:email` scope was granted and `/user` returned no email, a non-ok `/user/emails` response now throws `GitHubAuthError` with code `emails_fetch_failed`, letting the caller decide (retry / degrade / abort) rather than producing a broken account. A genuinely email-less account — endpoint succeeds but the user has no verified address — still resolves to a documented `email: null`, distinct from the fetch failure.
- d9a8e30: Align the plugin cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from the stale 1.x ranges (`>=1.6.0` / `>=1.0.0` / `>=1.7.0` / `npm:@theokit/sdk@next`) to `^2.18.0` / `>=2.18.0`. The consumed surface (`AuthProvider` / `AuthResult` / `OAuthTransaction` from `@theokit/sdk/server/auth`; `subscribe` for realtime) is stable across 1.x→2.x, so the alignment is a pin bump, not a migration. Also removed the phantom `@theokit/plugin-rate-limit` peer dependency from `plugin-copilot` (no such package exists; its rate-limit config is a type-only opt-in — `no-stubs-no-mocks-no-wired` clean). Validated: all 11 packages typecheck + build + test green against 2.18.0 (661 tests).
- 342239f: Reduce the cyclomatic complexity of eight audit-flagged functions (CC 16–24) by extracting behavior-preserving named helpers (#182–#189). No behavior change and no public API change — all existing tests stay green. Touched: `github()`'s callback (auth-github); `createInMemoryArtifactStore`, `serializeArtifactForCopy`, and `classifyRemoved` (plugin-canvas); `defineCopilot` (plugin-copilot); the realtime subscription effect (plugin-realtime); and `handleSttRequest`/`handleTtsRequest` (plugin-voice). Six functions now measure CC ≤ 10; `serializeArtifactForCopy` (a 9-kind discriminated-union exhaustive switch) and the in-memory `memList` sit at the idiomatic floor — `lizard`'s TypeScript parser mis-merges their adjacent module helpers into one range, overstating the per-function number, but each real function is ≤ 10.

All notable changes to `@theokit/auth-github` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-03

### Added

- `github(opts)` factory returns `AuthProvider<GitHubProfile, 'github'>` compatible with `defineAuth({ providers: [...] })`.
- OAuth 2.0 authorization-code flow (no OIDC discovery; no PKCE — GitHub does not implement RFC 7636). CSRF defense via `state` per RFC 6749 §10.12.
- Hardcoded endpoints overridable via `opts.authorizationEndpoint` / `tokenEndpoint` / `userinfoEndpoint` / `userEmailsEndpoint` (GitHub Enterprise Server support).
- Conditional `/user/emails` second fetch when `scopes` include `user:email` and `/user.email` is null — picks the primary verified email per Wasp blueprint Q1 pattern.
- `GitHubProfile.id` preserved as `number` (ADR D9 — no type coercion).
- `Authorization: token <X>` header for userinfo (NOT `Bearer X`) per GitHub REST API docs.
- Typed `GitHubAuthError` with stable `code` field (7 codes): `missing_code`, `state_mismatch`, `token_exchange_failed`, `missing_access_token`, `userinfo_fetch_failed`, `missing_id`, `missing_login`.
- 11 tests in `tests/github-provider.test.ts` covering all plan TDD checklist items + 2 extra (state-mismatch CSRF, token-exchange Accept header).

### Internal

- `src/sdk-shim.ts` mirrors `AuthProvider<TProfile, TName>` from `@theokit/sdk/server/auth` until SDK 1.6.0 publishes (T5.1). Drop in T5.2.
- Zero crypto in this package; no theokit primitives imported (GitHub flow needs no PKCE/OIDC, so the dependency surface is smaller than `@theokit/auth-google`).
