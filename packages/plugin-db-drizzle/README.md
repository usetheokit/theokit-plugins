# @theokit/plugin-db-drizzle

Standalone DB plugin for TheoKit — wraps drizzle-kit and `@theokit/orm` behind a single plugin-shape factory.

> **Status:** v0.1.0 initial publish on the `@next` tag. Promote to `@latest` is calendar-gated alongside the Onda 2 cohort.

> **`theokit db <verb>` does not exist.** This README promised seven CLI
> subcommands and a devtools tab for several releases; neither could ever run.
> `register()` wired them by calling `app.registerCliCommand()` /
> `app.registerDevtoolsTab()`, and the framework's `TheoApp` has only `addHook`
> and `decorateRequest` — the calls sat behind `if (app.registerCliCommand)`
> guards, so the result was a silent no-op rather than an error. The `theokit`
> CLI itself knows `build`, `dev`, `doctor`, `start` and has no plugin extension
> point. Tracked in #43; the command builders are still here and still tested,
> reachable now as exported functions (see § Migrations and studio).

## What you get

- One `drizzleDb(opts)` call, carrying resolved options your own tooling can read.
- `buildDbCommands(options)` — the seven drizzle-kit invocations as data, to wire into a script of your own.
- `buildDevtoolsTab(options)` — the studio-IFRAME tab descriptor, for whatever overlay you actually have.

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
import { config } from 'theokit'

export default config()
  .set({
    plugins: [
      drizzleDb({
        driver: 'postgres',
        url: process.env.DATABASE_URL,
        schemaPath: './db/schema.ts',
        migrationsPath: './db/migrations',
      }),
    ],
  })
  .build()
```

## Options reference

| Option           | Type                                | Default             | Notes                                            |
| ---------------- | ----------------------------------- | ------------------- | ------------------------------------------------ |
| `driver`         | `'sqlite' \| 'postgres' \| 'mysql'` | (required)          | Canonical drizzle-kit driver names               |
| `url`            | `string`                            | (caller-provided)   | Connection URL — pass `process.env.DATABASE_URL` |
| `schemaPath`     | `string`                            | `'./db/schema.ts'`  | Path to your drizzle schema file                 |
| `migrationsPath` | `string`                            | `'./db/migrations'` | Directory for generated migration files          |
| `devtoolsTab`    | `boolean`                           | `true`              | Register a devtools-overlay tab when present     |

## Migrations and studio

There is no `theokit db` command to call (see the note at the top). What the
package gives you is the seven drizzle-kit invocations as data, so you wire them
where your project already keeps its scripts:

```ts
// scripts/db.ts
import { buildDbCommands, drizzleDb } from '@theokit/plugin-db-drizzle'
import { spawnSync } from 'node:child_process'

const plugin = drizzleDb({ driver: 'postgres', url: process.env.DATABASE_URL! })
const verb = process.argv[2]
const cmd = buildDbCommands(plugin.options).find((c) => c.verb === verb)
if (!cmd) throw new Error(`unknown verb ${verb}`)

spawnSync('npx', ['drizzle-kit', ...cmd.buildArgs(plugin.options)], { stdio: 'inherit' })
```

```json
{ "scripts": { "db": "tsx scripts/db.ts" } }
```

```bash
pnpm db generate    # migration from schema diff
pnpm db migrate     # apply pending migrations
pnpm db push        # push schema directly (dev-only)
pnpm db studio      # drizzle-kit studio (visual DB explorer)
pnpm db reset       # drop tables + re-apply all migrations
pnpm db seed        # run the user-provided seed script
pnpm db check       # check schema drift
```

Every verb shells out to `drizzle-kit`. Without it installed your runtime app
still works — only these fail, with drizzle-kit's own message.

## Devtools tab

`buildDevtoolsTab(options)` returns a `{ id, label, mount }` descriptor that
IFRAMEs `http://localhost:4983` (drizzle-kit's default studio port). Mount it in
whatever overlay you have:

```ts
import { buildDevtoolsTab, drizzleDb } from '@theokit/plugin-db-drizzle'

const tab = buildDevtoolsTab(drizzleDb({ driver: 'sqlite', url: ':memory:' }).options)
tab.mount(document.getElementById('panel')!)
```

The plugin does **not** register it for you — there is no framework hook to
register it through (#43). `drizzleDb({ devtoolsTab: false })` still resolves to
`false` in `options`, so your own wiring can honour the flag.

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
