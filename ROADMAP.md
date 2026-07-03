# Roadmap — theokit-plugins

> **Reconciled with the ecosystem ROADMAP (2026-07-03, milestone M6).** The
> canonical cross-pillar roadmap lives at `theokit-tools/ROADMAP.md` (M0–M8);
> this repo is **subsumed** by it as part of the Harness cluster that M6 (cluster
> consolidation) aligns to the hardened `@theokit/sdk` 2.18.0 Harness. This file
> tracks the plugins-specific status only.

## Status — 11 first-party plugins shipped, aligned to `@theokit/sdk` 2.18.0

The earlier "empty by design" posture is retired. The repo ships **11 first-party
plugins**, all building + testing green against the M0–M3 Harness (`@theokit/sdk`
2.18.0) as of M6.

### Auth providers (consume `@theokit/sdk/server/auth`)

| Package | Version | Purpose |
| --- | --- | --- |
| `@theokit/auth-github` | 0.1.0 | GitHub OAuth 2.0 provider (state-only CSRF) |
| `@theokit/auth-google` | 0.1.0 | Google OIDC provider + SSRF hardening |
| `@theokit/auth-magic-link` | 0.1.0 | Passwordless email provider (pluggable store) |

### Capability plugins

| Package | Version | Purpose | SDK coupling |
| --- | --- | --- | --- |
| `@theokit/plugin-canvas` | 0.3.0 | Artifact protocol (markdown/code/svg/diff/mermaid/html/image) + DOMPurify CSP-safe render | soft (types) |
| `@theokit/plugin-copilot` | 0.1.0 | AI Copilot runtime (presence-aware, budget bridge, voice/canvas bridges) | soft (types) |
| `@theokit/plugin-realtime` | 0.1.0 | Multiplayer (presence/room/broadcast, Yjs CRDT opt-in) | soft (`subscribe`) |
| `@theokit/plugin-db-drizzle` | 0.1.0 | Drizzle ORM wrapper (7-verb CLI, studio passthrough) | none (`@theokit/orm`) |
| `@theokit/plugin-email` | 0.1.0 | Email (Resend default, React-Email opt-in) | none |
| `@theokit/plugin-forms` | 0.1.2 | Form binding (zod + react-hook-form + useAction) | none (`@theokit/react`) |
| `@theokit/plugin-payments` | 0.1.0 | Stripe (webhook dispatcher, signature verify, idempotency) | none |
| `@theokit/plugin-voice` | 0.7.0 | STT/TTS bridge (browser MediaRecorder, timeout wiring) | none |

**M6 alignment (2026-07-03):** every `@theokit/sdk` peer/dev pin bumped from the
stale 1.x ranges (`>=1.6.0` / `>=1.0.0` / `>=1.7.0` / `npm:@theokit/sdk@next`) to
`^2.18.0` / `>=2.18.0`. The consumed surface (`AuthProvider` / `AuthResult` /
`OAuthTransaction` from `@theokit/sdk/server/auth`; `subscribe` for realtime) is
stable across 1.x→2.x, so the alignment is a pin bump, not a migration. Validated:
11/11 packages typecheck + build + test green (661 tests). The phantom
`@theokit/plugin-rate-limit` peer dep (no such package exists) was removed from
`plugin-copilot` — its rate-limit config is a documented type-only opt-in
(`no-stubs-no-mocks-no-wired` clean).

## Future plugins — demand-gated (unchanged philosophy)

New plugins beyond the 11 above still follow the moderate demand-gate. A plugin
ships only when ALL hold:

1. 1+ app in production using a draft/community version
2. 3+ requests in GitHub discussions
3. Doesn't duplicate a Harness core primitive (see exclusions below)
4. Maintainable: <100 LOC OR <1 week of maintenance per year
5. Tests + fixture project

Previously-proposed `@theokit/plugin-cors` / `-sentry` / `-i18n` are NOT in this
repo; they remain demand-gated proposals to revisit under the ecosystem roadmap
when demand is evidenced. Other demand-gated candidates: `plugin-otel`,
`plugin-resend`, `plugin-stripe-webhooks`, `plugin-clerk`/`-auth0`/`-workos`,
`plugin-feature-flags`, `plugin-inngest`/`-trigger-dev` (0 apps / 0 requests each).

## Exclusions — already in the Harness (don't propose as plugins)

| Need | Already in `@theokit/sdk` |
| --- | --- |
| Security headers (CSP/HSTS/X-Frame) | security-hardening defaults |
| Cookies | `getCookie` / `setCookie` / `deleteCookie` |
| Rate limit | `createRateLimiter` + pluggable store |
| Secret redaction | `Security.redact` (ADR D68) |
| Multipart upload | `parseRequestBody` + busboy |
| Postgres / Redis | `usePostgres` / `useRedis` + `StorageManager` |
| KV / SQL / custom client | `useUnstorage` / `useDatabase` / `useStorage<T>` |
| WebSocket / Cron / Webhooks | `defineWebSocket` / `defineCron` / `defineWebhook` |
| Auth (PKCE/OAuth state/TOTP/sessions) | RFC-aligned primitives in core |

## How to propose a new plugin

First-party (under `@theokit/plugin-*`): open a discussion at
https://github.com/usetheodev/theokit/discussions titled `[plugin proposal] <name>`,
show a real production use case + 3+ requests + why it can't be a core primitive;
if a maintainer accepts, a package skeleton lands in `packages/`. Community (under
`@<your-scope>/theokit-plugin-*`): publish anywhere, add the `theokit-plugin`
keyword. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Release

Independent per-package Changesets, coordinated with the ecosystem release train
(M6). The cluster releases together with the `@theokit/sdk` 2.18.0 Harness it pins.

## Status legend

- ✅ Shipped — published to npm, aligned to `@theokit/sdk` 2.18.0
- ⏳ Demand-gated — won't enter the shipped set until the gates clear
