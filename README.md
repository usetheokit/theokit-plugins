# theokit-plugins

> Official first-party plugins for the [TheoKit](https://github.com/usetheokit/theokit) framework.

## These are FRAMEWORK plugins

Everything in this repository extends a `theokit` **application** — routes, UI, devtools, CLI
verbs. Installing one of these does nothing for an agent.

The agent has its own, unrelated plugin system in `@theokit/sdk`: `PermissionPlugin.create(…)`,
`Handoff.asPlugin(…)`, passed as `Agent.create({ plugins: [ … ] })`. Same word, different layer,
different registration. That option additionally has two mutually exclusive forms — an array of
code plugins, or `{ enabled: [...] }` selecting plugins discovered under `.theokit/plugins/` — and
the SDK's README explains why `agent.pluginsManager` can read empty while a plugin is working.

## Status

**11 first-party plugins shipped.** Three auth providers (`auth-github`, `auth-google`,
`auth-magic-link`) plus eight capability plugins (`plugin-canvas`, `plugin-copilot`,
`plugin-realtime`, `plugin-db-drizzle`, `plugin-email`, `plugin-forms`, `plugin-payments`,
`plugin-voice`). The four that consume `@theokit/sdk` build against `^2.18.0`; the rest
integrate through `theokit` or through React alone.

The demand gates that govern **future** plugins beyond these 11 are below, under
[How to propose a plugin](#how-to-propose-a-plugin).

## What's already in TheoKit core (don't propose these as plugins)

Many things that became Fastify-style plugins are **direct primitives** in TheoKit:

| Need                                  | TheoKit primitive                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Security headers (CSP/HSTS/X-Frame)   | Built-in via security-hardening defaults                                                                          |
| Cookies                               | `import { getCookie, setCookie, deleteCookie } from 'theokit/server/http'`                                        |
| Rate limit                            | `import { createRateLimiter } from 'theokit/server/rate-limit'`, with a pluggable store                           |
| Multipart upload                      | `import { parseRequestBody } from 'theokit/server/http'` (busboy)                                                 |
| Postgres                              | `getStorageManager().usePostgres(dbName, factory)`                                                                |
| Redis                                 | `getStorageManager().useRedis(serverName, factory)`                                                               |
| KV (Redis/S3/CF KV/Vercel KV/…)       | `import { useUnstorage } from 'theokit/server/storage'` (20+ unstorage drivers)                                   |
| SQL non-PG (libSQL/D1/MySQL/SQLite)   | `import { useDatabase } from 'theokit/server/storage'` (db0 connectors)                                           |
| Any custom client (Mongo/DynamoDB/…)  | `getStorageManager().useStorage<T>(name, factory)`                                                                |
| WebSocket                             | `import { websocket } from 'theokit/server/define'`                                                               |
| Cron                                  | `import { defineCron } from 'theokit/server/cron'`                                                                |
| Webhooks                              | `import { defineWebhook } from 'theokit/server/webhook'`                                                          |
| OpenAPI generation                    | `import { route } from 'theokit/server/define'` + Zod, emitted by `theokit openapi` (opt-in via `config.openapi`) |
| Auth (PKCE/OAuth state/TOTP/sessions) | RFC-aligned primitives in core                                                                                    |

Postgres, Redis and custom clients are methods of the `StorageManager` singleton, not standalone
exports. Each caches one client per name and calls its factory once:

```ts
import { getStorageManager, type PostgresFactory, type RedisFactory } from 'theokit/server/storage'

declare const createPool: PostgresFactory // for example (server, db) => new pg.Pool({ ... })
declare const createRedis: RedisFactory // for example (config) => new Redis(config.url)

const storage = getStorageManager()
const pool = storage.usePostgres('main', createPool)
const redis = storage.useRedis('cache', createRedis)
const sessions = storage.useStorage('sessions', () => new Map<string, string>())

export { pool, redis, sessions }
```

`pnpm quality:doc-api` type-checks every import in the table and the example above against the
`theokit` release pinned in the root `package.json`, so a rename in TheoKit fails this repository's
CI instead of reaching a reader.

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

1. Open an issue titled `[plugin proposal] <name>` on [usetheokit/theokit](https://github.com/usetheokit/theokit/issues).
2. Show: real production use case, 3+ requests from others, why it can't be a core primitive.
3. If accepted, a maintainer creates the package in this repo's `packages/`.

## How to ship a community plugin (no gates, no permission required)

Use the naming convention `@<your-scope>/theokit-plugin-<name>` (e.g., `@acme/theokit-plugin-stripe`). Publish wherever. Add a `theokit-plugin` keyword in `package.json`. Eventually a "community plugins" page in TheoKit docs will link verified ones.

See the [plugin authoring guide](https://theokit.dev/docs/plugins) for the full contract.

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
