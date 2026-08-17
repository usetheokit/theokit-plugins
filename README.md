# theokit-plugins

> Official first-party plugins for the [TheoKit](https://github.com/usetheokit/theokit) framework.

## Status

**11 first-party plugins shipped, aligned to `@theokit/sdk` 2.18.0** (ecosystem
milestone M6). Three auth providers (`auth-github`, `auth-google`, `auth-magic-link`)
plus eight capability plugins (`plugin-canvas`, `plugin-copilot`, `plugin-realtime`,
`plugin-db-drizzle`, `plugin-email`, `plugin-forms`, `plugin-payments`, `plugin-voice`).
All build + test green against the hardened M0–M3 Harness (661 tests). See
[`ROADMAP.md`](./ROADMAP.md) for the full table and the demand-gate criteria that
still govern **future** plugins beyond these 11.

## What's already in TheoKit core (don't propose these as plugins)

Many things that became Fastify-style plugins are **direct primitives** in TheoKit:

| Need                                  | TheoKit primitive                          |
| ------------------------------------- | ------------------------------------------ |
| Security headers (CSP/HSTS/X-Frame)   | Built-in via security-hardening defaults   |
| Cookies                               | `getCookie` / `setCookie` / `deleteCookie` |
| Rate limit                            | `createRateLimiter` + pluggable store      |
| Multipart upload                      | `parseRequestBody` + busboy                |
| Postgres                              | `usePostgres` + `StorageManager`           |
| Redis                                 | `useRedis` + `StorageManager`              |
| KV (Redis/S3/CF KV/Vercel KV/…)       | `useUnstorage` (20+ unstorage drivers)     |
| SQL non-PG (libSQL/D1/MySQL/SQLite)   | `useDatabase` (db0 connectors)             |
| Any custom client (Mongo/DynamoDB/…)  | `useStorage<T>` generic                    |
| WebSocket                             | `defineWebSocket`                          |
| Cron                                  | `defineCron`                               |
| Webhooks                              | `defineWebhook`                            |
| OpenAPI generation                    | Auto from `defineRoute` + Zod              |
| Auth (PKCE/OAuth state/TOTP/sessions) | RFC-aligned primitives in core             |

## Realistic plugin candidates (NOT shipping yet)

The list below is **hypothetical**. Each item will only become a real package when it passes the gates above.

- `@theokit/plugin-cors` — CORS middleware (real gap in core)
- `@theokit/plugin-sentry` — Error tracking
- `@theokit/plugin-otel` — OpenTelemetry exporter (TheoKit has trace context but no exporter)
- `@theokit/plugin-stripe-webhooks` — Stripe signature verification sugar over `defineWebhook`
- `@theokit/plugin-resend` — Email helpers for Resend
- `@theokit/plugin-clerk` / `-auth0` / `-workos` — Hosted auth bridges
- `@theokit/plugin-i18n` — Internationalization
- `@theokit/plugin-feature-flags` — GrowthBook / LaunchDarkly bridges
- `@theokit/plugin-inngest` / `-trigger-dev` — Workflow engine bridges

## How to propose a plugin

1. Open a discussion at [usetheodev/theokit](https://github.com/usetheokit/theokit/discussions) titled `[plugin proposal] <name>`.
2. Show: real production use case, 3+ requests from others, why it can't be a core primitive.
3. If accepted, a maintainer creates the package in this repo's `packages/`.

## How to ship a community plugin (no gates, no permission required)

Use the naming convention `@<your-scope>/theokit-plugin-<name>` (e.g., `@acme/theokit-plugin-stripe`). Publish wherever. Add a `theokit-plugin` keyword in `package.json`. Eventually a "community plugins" page in TheoKit docs will link verified ones.

See [`docs/concepts/plugins.md`](https://github.com/usetheokit/theokit/blob/main/docs/concepts/plugins.md) §7 for the full plugin authoring guide.

## Repository layout (when populated)

```
theokit-plugins/
├── packages/
│   └── plugin-<name>/
│       ├── src/index.ts
│       ├── tests/index.test.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
├── .changeset/        # per-package versioning
├── .github/workflows/ # CI per push, release on main
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json
└── CHANGELOG.md
```

## Versioning

Per-package via [Changesets](https://github.com/changesets/changesets). Each package follows semver independently. Plugins declare TheoKit as a peer-dep with a range (`"theokit": ">=0.5.0"`) and bump explicitly on TheoKit majors.

## License

MIT — same as the TheoKit core. See [LICENSE](./LICENSE).

## Related

- [TheoKit framework](https://github.com/usetheokit/theokit) — the core
- [TheoKit SDK](https://github.com/usetheokit/theokit-sdk) — agent runtime
- [@theokit/ui](https://github.com/usetheokit/theokit-ui) — AI-native React component library (chat + coding-agent surfaces); depends on [@usetheo/ui](https://www.npmjs.com/package/@usetheo/ui) for generic primitives + cloud-ops components
