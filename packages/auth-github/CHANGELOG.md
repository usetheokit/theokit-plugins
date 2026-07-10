# Changelog

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
