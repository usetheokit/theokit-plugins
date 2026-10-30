# @theokit/plugin-db-drizzle

drizzle-kit helpers for TheoKit apps. You declare your database once with `drizzleDb(...)`, and
the package turns that declaration into the drizzle-kit command lines and the `drizzle.config.ts`
your own `db` script runs.

> **What this package does not do.** It registers nothing at runtime: `drizzleDb(...).register()`
> is empty, so adding the plugin to `theo.config.ts` connects to no database, adds no CLI command
> and mounts no devtools tab. It never opens a connection or spawns a process itself. It also does
> not depend on, wrap or re-export `@theokit/orm`.
>
> The `theokit db migrate | generate | seed` commands in the `theokit` CLI (0.75 and later) are
> part of TheoKit and do not use this plugin.

## What you get

| Export                         | What it returns                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `drizzleDb(options)`           | A plugin object whose `options` field holds your options with every default filled in. Its `register()` does nothing.     |
| `buildDbCommands(options)`     | Seven command descriptors (`generate`, `migrate`, `push`, `studio`, `reset`, `seed`, `check`) for your own script to run. |
| `renderDrizzleConfig(options)` | The text of a `drizzle.config.ts`, for the verbs drizzle-kit only drives through `--config`.                              |
| `buildDevtoolsTab(options)`    | A `{ id, label, studioUrl, mount }` descriptor that frames drizzle-kit studio, for an overlay of your own.                |

Pass `drizzleDb(...).options` to the three builders. They take the resolved shape, and a
hand-written object missing a field builds an argv with `undefined` in it instead of failing.

## Install

```bash
pnpm add @theokit/plugin-db-drizzle drizzle-orm
pnpm add -D drizzle-kit
```

`drizzle-orm` is a peer because your schema file imports it; this package does not. `drizzle-kit`
is an optional peer: only the commands you build need it.

## Declare the database

```ts
import { drizzleDb } from '@theokit/plugin-db-drizzle'

export const db = drizzleDb({
  driver: 'postgres',
  url: process.env.DATABASE_URL,
  schemaPath: './db/schema.ts',
  migrationsPath: './db/migrations',
})
```

Listing `db` under `plugins` in `theo.config.ts` is allowed and changes nothing at runtime. Keep it
in a module your scripts can import.

## Options reference

| Option           | Type                                | Default                          | Notes                                                      |
| ---------------- | ----------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `driver`         | `'sqlite' \| 'postgres' \| 'mysql'` | (required)                       | Mapped to drizzle-kit's `--dialect`                        |
| `url`            | `string`                            | (none)                           | Connection URL; the package does not read `DATABASE_URL`   |
| `schemaPath`     | `string`                            | `'./db/schema.ts'`               | Your drizzle schema file                                   |
| `migrationsPath` | `string`                            | `'./db/migrations'`              | Where `generate` writes migrations                         |
| `configPath`     | `string`                            | `'./.theokit/drizzle.config.ts'` | Where your script writes `renderDrizzleConfig(...)`        |
| `seedScript`     | `string`                            | (none)                           | Script the `seed` verb runs; drizzle-kit has no `seed`     |
| `resetScript`    | `string`                            | (none)                           | Script the `reset` verb runs; drizzle-kit has no `reset`   |
| `studioHost`     | `string`                            | `'localhost'`                    | Host for `studio` and the devtools tab                     |
| `studioPort`     | `number`                            | `4983`                           | Port for `studio` and the devtools tab                     |
| `devtoolsTab`    | `boolean`                           | `true`                           | Carried on `options` for your own wiring; nothing reads it |

## A `db` script

Each command says how to run it in `kind`:

- `drizzle-kit`: run `drizzle-kit` with `buildArgs()`.
- `drizzle-kit-with-config`: write `renderDrizzleConfig(options)` to `options.configPath` first,
  then run `drizzle-kit` with `buildArgs()`. `migrate` and `studio` accept only `--config`.
- `user-script`: `buildArgs()` returns your `seedScript` or `resetScript`; run that. It throws when
  the script is not configured.

`reset` also sets `requiresForce`, so the script below refuses it without `--force`.

```ts
// scripts/db.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildDbCommands, drizzleDb, renderDrizzleConfig } from '@theokit/plugin-db-drizzle'

const { options } = drizzleDb({ driver: 'postgres', url: process.env.DATABASE_URL })
const [verb, ...rest] = process.argv.slice(2)
const cmd = buildDbCommands(options).find((c) => c.verb === verb)
if (!cmd) throw new Error(`unknown verb ${verb}`)
if (cmd.requiresForce && !rest.includes('--force')) throw new Error(`db ${verb} needs --force`)

if (cmd.kind === 'drizzle-kit-with-config') {
  mkdirSync(dirname(options.configPath), { recursive: true })
  writeFileSync(options.configPath, renderDrizzleConfig(options))
}
const [file, args] =
  cmd.kind === 'user-script'
    ? ['npx', ['tsx', ...cmd.buildArgs()]]
    : ['npx', ['drizzle-kit', ...cmd.buildArgs()]]
const result = spawnSync(file, args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
```

```json
{ "scripts": { "db": "tsx scripts/db.ts" } }
```

```bash
pnpm db generate       # drizzle-kit generate: migration from the schema diff
pnpm db migrate        # drizzle-kit migrate, through the generated config
pnpm db push           # drizzle-kit push: schema straight to the database (development)
pnpm db studio         # drizzle-kit studio, through the generated config
pnpm db check          # drizzle-kit check
pnpm db seed           # your seedScript
pnpm db reset --force  # your resetScript
```

The generated config is rewritten on every run; add `.theokit/` to `.gitignore`.

## Devtools tab

`buildDevtoolsTab(options)` returns a descriptor whose `mount(container)` appends an `<iframe>`
pointing at `http://<studioHost>:<studioPort>` (drizzle-kit studio's default is
`http://localhost:4983`). Nothing registers it for you; mount it in an overlay you own:

```ts
import { buildDevtoolsTab, drizzleDb } from '@theokit/plugin-db-drizzle'

const tab = buildDevtoolsTab(drizzleDb({ driver: 'sqlite', url: ':memory:' }).options)
tab.mount(document.getElementById('panel')!)
```

## License

Apache-2.0
