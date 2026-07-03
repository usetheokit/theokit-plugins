# Changelog

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
