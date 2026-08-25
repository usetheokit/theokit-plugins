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

- bfa7409: The README examples now use the API `theokit@0.48` exports, and every one of them was verified by compiling it rather than by reading it. Ten names they told you to import — `defineConfig`, `defineRoute`, `definePlugin`, `defineAction`, `defineAgentTool`, `defineTheoConfig`, `defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`, `useAgentStream` — exist in none of that version's 24 export subpaths. Copying the first block of most of these READMEs produced code that did not compile.

  The `auth-google` and `auth-magic-link` wiring examples changed shape rather than names: the auth orchestrator takes Node's `IncomingMessage`/`ServerResponse`, and no handler surface TheoKit exposes today hands you those, so the examples show a Node server and state the gap.

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

- 340b78d: Close an OIDC SSRF that could exfiltrate `client_secret` + the authorization code (#192). The provider now validates every URL it fetches — the discovery base and the discovered `authorization_endpoint`, `token_endpoint`, and `userinfo_endpoint` — and rejects any non-`https` URL (`GoogleAuthError` code `insecure_oidc_url`), with a loopback carve-out (`localhost`/`127.0.0.0/8`/`::1`) so local test sidecars can serve `http`. The `MOCK_GOOGLE_OIDC_BASE_URL` test override is now honored only when it targets a loopback host (else `GoogleAuthError` code `ssrf_env_override_non_loopback`), so a leaked `NODE_ENV=test` can no longer redirect the credential-bearing token exchange to an external attacker.

  The audit's prescribed "discovered endpoint host must equal the base host" sub-fix was deliberately not adopted: Google's real discovery spans `accounts.google.com` / `oauth2.googleapis.com` / `openidconnect.googleapis.com`, so strict host-equality would break production sign-in. The https-except-loopback rule closes the same plaintext-exfil vector without that breakage.

- 298e5d6: Reject `http://0.0.0.0` OIDC endpoints as insecure (review finding F-sec-3). `isLoopbackHost` previously treated `0.0.0.0` as loopback and exempted it from the https-only OIDC URL rule, so a poisoned discovery document pointing an endpoint at `http://0.0.0.0:PORT` could carry a `client_secret`-bearing request over plaintext. `0.0.0.0` is the wildcard/INADDR_ANY bind address, not a loopback destination — it is no longer exempt (the normalized short form `http://0/` is rejected by the same omission). Genuine loopback hosts (`localhost`, `127.0.0.0/8`, `::1`) remain http-exempt. No public API change.
- d9a8e30: Align the plugin cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from the stale 1.x ranges (`>=1.6.0` / `>=1.0.0` / `>=1.7.0` / `npm:@theokit/sdk@next`) to `^2.18.0` / `>=2.18.0`. The consumed surface (`AuthProvider` / `AuthResult` / `OAuthTransaction` from `@theokit/sdk/server/auth`; `subscribe` for realtime) is stable across 1.x→2.x, so the alignment is a pin bump, not a migration. Also removed the phantom `@theokit/plugin-rate-limit` peer dependency from `plugin-copilot` (no such package exists; its rate-limit config is a type-only opt-in — `no-stubs-no-mocks-no-wired` clean). Validated: all 11 packages typecheck + build + test green against 2.18.0 (661 tests).

All notable changes to `@theokit/auth-google` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-03

### Added

- `google(opts)` factory returns `AuthProvider<GoogleProfile, 'google'>` compatible with `defineAuth({ providers: [...] })` from `@theokit/sdk/server/auth`.
- OIDC discovery + PKCE (S256) + authorization-code flow + userinfo fetch end-to-end (RFC 6749, RFC 7636, OpenID Connect Core 1.0).
- `GoogleProfile` type with case-sensitive `sub` per ADR D9 (Wasp incident lesson — `sub` is never normalized or lowercased).
- `GoogleProviderOptions.oidcBaseUrl` for overriding discovery base URL (defaults to `https://accounts.google.com`).
- Test-only `MOCK_GOOGLE_OIDC_BASE_URL` env override gated on `NODE_ENV === 'test'` (per plan G11 v1.1 EC-3) — unblocks Playwright sidecar OIDC mock pattern. Production builds (`NODE_ENV !== 'test'`) ignore the env var.
- Typed `GoogleAuthError` with stable `code` field: `missing_pkce_verifier`, `missing_code`, `state_mismatch`, `token_exchange_failed`, `missing_access_token`, `no_userinfo_endpoint`, `userinfo_fetch_failed`, `missing_sub`, `missing_email`.
- 13 tests across two files: 3 scaffold (`tests/scaffold.test.ts`) + 10 provider behavior (`tests/google-provider.test.ts`) including Wasp `sub` case-sensitivity regression, 401 token-exchange error mapping, state-mismatch CSRF guard, and the three EC-3 env-override variants.

### Internal

- `src/sdk-shim.ts` mirrors the `AuthProvider<TProfile, TName>` contract from `@theokit/sdk/server/auth` (SDK 1.6.0, unpublished at scaffold time). Replaced with direct import in T5.2 once SDK 1.6.0 publishes to npm.
- Composes theokit primitives only (`discoverOidcProvider` + `pkceChallengeFromVerifier`) — does NOT reinvent OIDC discovery, PKCE, or state crypto.

### Planned (T5.2)

- Drop `src/sdk-shim.ts`. Switch to `import type { AuthProvider } from '@theokit/sdk/server/auth'`.
- Bump peerDep `@theokit/sdk` to `>=1.6.0`.
- Publish to npm `@next` tag (per ADR D3).
