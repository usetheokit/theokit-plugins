# Changelog

## 0.2.0

### Minor Changes

- 88fbb04: **BREAKING (pre-1.0, data format):** magic-link tokens are now hashed (SHA-256) before storage — the built-in memory and ORM stores persist `sha256(token)` instead of the raw token, so a store/DB/log leak no longer exposes live credentials (#191). The `MagicLinkStore`/`MagicLinkRepository` interfaces are unchanged (they still receive the raw token; hashing is internal); only the persisted value changes. Existing un-consumed plaintext rows from a prior version will no longer match and will expire naturally within the token TTL (≤15 min default) — no live credential is stranded.

  Also documents (#190) that magic-link tokens are intentionally **unbound bearer credentials** (cross-device by design): `handleCallback` does not validate the OAuth `tx.state`, because magic-link has no redirect round-trip and the click may land on a different device. Security rests on token entropy + short TTL + single-use + hash-at-rest. This supersedes the plan's ADR D6 (which proposed tx.state binding on a false premise).

### Patch Changes

- 70eb7a4: Harden magic-link request handling: the default email resolver now caps the request body it buffers (16 KB) to prevent a large-POST DoS (#204) and narrows its error handling so transport/stream errors propagate instead of being silently swallowed to a null email (#209). The callback URL is built via the URL API (no double slash when the base has a trailing slash), and `magicLink()` now validates `callbackBaseUrl` at construction — throwing `MagicLinkConfigError` if it is not an absolute http(s) URL (#205).
- d9a8e30: Align the plugin cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from the stale 1.x ranges (`>=1.6.0` / `>=1.0.0` / `>=1.7.0` / `npm:@theokit/sdk@next`) to `^2.18.0` / `>=2.18.0`. The consumed surface (`AuthProvider` / `AuthResult` / `OAuthTransaction` from `@theokit/sdk/server/auth`; `subscribe` for realtime) is stable across 1.x→2.x, so the alignment is a pin bump, not a migration. Also removed the phantom `@theokit/plugin-rate-limit` peer dependency from `plugin-copilot` (no such package exists; its rate-limit config is a type-only opt-in — `no-stubs-no-mocks-no-wired` clean). Validated: all 11 packages typecheck + build + test green against 2.18.0 (661 tests).

All notable changes to `@theokit/auth-magic-link` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-03

### Added

- `magicLink(opts)` factory returns `AuthProvider<MagicLinkProfile, 'magic-link'>` PLUS a `startSignIn(req)` method (magic-link does not use the OAuth `createAuthorizationURL` shape — see README "Wiring").
- 32-byte URL-safe random tokens (43 base64url chars from `crypto.randomBytes`).
- Pluggable `MagicLinkStore` per ADR D7. Two adapters shipped:
  - `createMemoryStore()` — dev/test only. JS event-loop guarantees atomicity for concurrent `consumeToken` calls (EC-11 absorbed).
  - `createOrmStore(repo: MagicLinkRepository)` — production. Atomicity delegated to the Repository contract (UPDATE...RETURNING under the hood for Postgres/MySQL/SQLite).
- Consumer-supplied `sendEmail` callback per ADR D8 — apps wire any transport (Resend, SendGrid, SMTP, console.log for dev). Transport errors propagate (D8 invariant: NEVER swallowed).
- Default token lifetime 15 minutes (configurable via `opts.tokenLifetimeMs`).
- Default `resolveEmail` reads query `?email=` first, then JSON / form-encoded body. Override via `opts.resolveEmail` for custom request shapes.
- Email validation at input boundary (EC-12 absorbed): missing / blank / malformed email throws `MagicLinkConfigError(code: 'invalid_email')` BEFORE token creation.
- Typed errors: `MagicLinkAuthError` (callback-time: `missing_token`, `invalid_or_expired_token`) + `MagicLinkConfigError` (start-time: `invalid_email`, `use_start_sign_in`).
- 15 tests in `tests/magic-link.test.ts`:
  - 5 store tests (isolation, single-use, EC-11 race, cleanup, expiry)
  - 1 ORM integration test (in-memory `MagicLinkRepository` round-trip)
  - 4 startSignIn tests (token shape + persist + email; EC-12 missing/malformed; D8 propagation)
  - 5 handleCallback tests (success, missing_token, unknown, expired, re-use rejection)

### Internal

- `src/sdk-shim.ts` mirrors `AuthProvider<TProfile, TName>` from `@theokit/sdk/server/auth` until SDK 1.6.0 publishes (T5.1). Drop in T5.2.
- Zero runtime deps beyond Node built-ins.
