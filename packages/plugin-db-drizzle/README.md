# @theokit/plugin-db-drizzle

Standalone DB plugin for TheoKit — wraps drizzle-kit and `@theokit/orm` behind a single plugin-shape factory.

> **Status:** v0.1.0 initial publish on the `@next` tag. Promote to `@latest` is calendar-gated alongside the Onda 2 cohort.

## What you get

- One `drizzleDb(opts)` call wires drizzle into your TheoKit app.
- Seven `theokit db <verb>` CLI subcommands: `generate / migrate / push / studio / reset / seed / check`.
- Drizzle-kit studio passthrough (no custom UI baggage).
- Opt-in devtools tab that IFRAMEs the studio when the TheoKit devtools overlay is loaded.

`@theokit/orm` is a required peer — this plugin wraps it, never duplicates. Your Repository, `@InjectRepository`, `@Transactional`, and `OrmModule` keep working unchanged.

## Install

```bash
pnpm add @theokit/plugin-db-drizzle@next @theokit/orm@next drizzle-orm reflect-metadata
# Optional — only needed for the CLI verbs (generate/migrate/studio/...)
pnpm add -D drizzle-kit
```

## Wire it into `theo.config.ts`

```ts
import { drizzleDb } from '@theokit/plugin-db-drizzle'
import { defineConfig } from 'theokit'

export default defineConfig({
  plugins: [
    drizzleDb({
      driver: 'postgres',
      url: process.env.DATABASE_URL,
      schemaPath: './db/schema.ts',
      migrationsPath: './db/migrations',
    }),
  ],
})
```

## Options reference

| Option           | Type                                | Default             | Notes                                            |
| ---------------- | ----------------------------------- | ------------------- | ------------------------------------------------ |
| `driver`         | `'sqlite' \| 'postgres' \| 'mysql'` | (required)          | Canonical drizzle-kit driver names               |
| `url`            | `string`                            | (caller-provided)   | Connection URL — pass `process.env.DATABASE_URL` |
| `schemaPath`     | `string`                            | `'./db/schema.ts'`  | Path to your drizzle schema file                 |
| `migrationsPath` | `string`                            | `'./db/migrations'` | Directory for generated migration files          |
| `devtoolsTab`    | `boolean`                           | `true`              | Register a devtools-overlay tab when present     |

## CLI verbs

```bash
theokit db generate    # Generate migration from schema diff
theokit db migrate     # Apply pending migrations
theokit db push        # Push schema directly (dev-only)
theokit db studio      # Open drizzle-kit studio (visual DB explorer)
theokit db reset --force  # Drop tables + re-apply all migrations
theokit db seed        # Run the user-provided seed script
theokit db check       # Check schema drift
```

All verbs shell out to `drizzle-kit` via Node child_process. If you don't install `drizzle-kit`, your runtime app still works — only the CLI verbs error out with an actionable message.

## Devtools tab (opt-in)

When the TheoKit devtools overlay (G4) is loaded, the plugin registers a "Database" tab that IFRAMEs `http://localhost:4983` (drizzle-kit's default studio port). Run `theokit db studio` in another terminal to populate it.

Opt out via `drizzleDb({ devtoolsTab: false, ... })`.

**Production note:** the devtools overlay is dev-only. Production builds tree-shake the tab module — no IFRAME is emitted to your shipped bundle.

## RLS / auth integration

The plugin re-uses `@theokit/orm`'s `withAgentContext` AsyncLocalStorage. Wrap session-scoped queries the same way you do with orm direct:

```ts
import { withAgentContext } from '@theokit/orm'

await withAgentContext({ userId: session.userId }, async () => {
  return await users.findMany()
})
```

For native RLS policy generation, drizzle-kit's RLS support is the canonical path — this plugin does not add a layer on top.

## Migration from `@theokit/orm` direct usage

If you currently wire orm directly:

```ts
// Before
import { OrmModule } from '@theokit/orm'
defineConfig({
  modules: [OrmModule.forRoot({ connector: 'postgres', url: process.env.DATABASE_URL })],
})

// After
import { drizzleDb } from '@theokit/plugin-db-drizzle'
defineConfig({
  plugins: [drizzleDb({ driver: 'postgres', url: process.env.DATABASE_URL })],
})
```

Your Repository / decorator usage stays identical — the plugin re-exports orm's surface.

## License

MIT
