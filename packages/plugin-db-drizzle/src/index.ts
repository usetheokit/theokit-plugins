/**
 * @theokit/plugin-db-drizzle — standalone DB plugin (Form 4 Hybrid).
 *
 * Per plan p5-plugin-db-drizzle v1.0 + blueprint v1.0 (SHIPPABLE 98.8/100).
 *
 * Wraps @theokit/orm + drizzle-kit behind a theokit plugin-shape factory.
 * Re-exports orm's Repository / @InjectRepository / @Transactional / OrmModule
 * for single-import ergonomics. Adds:
 *
 * - `drizzleDb(opts): TheoPlugin` factory with `kind: 'db'`
 * - 7 CLI verbs (`theokit db <verb>`): generate/migrate/push/studio/reset/seed/check
 * - Devtools-tab opt-in (G4 overlay backward-compat)
 *
 * @public
 */

import { buildDbCommands } from './cli/db.js'
import { buildDevtoolsTab } from './devtools.js'
import { type DrizzleDbOptions, resolveOptions } from './options.js'
import type { DrizzleDbPlugin, TheoPluginApp } from './types.js'

export type { DrizzleDbOptions, DrizzleDriver, ResolvedDrizzleDbOptions } from './options.js'
export type { DrizzleDbPlugin, TheoPluginApp } from './types.js'

/**
 * Create a `@theokit/plugin-db-drizzle` plugin instance.
 *
 * Pass the returned plugin to your `theo.config.ts`:
 *
 * ```ts
 * import { drizzleDb } from "@theokit/plugin-db-drizzle";
 * import { defineConfig } from "theokit";
 *
 * export default defineConfig({
 *   plugins: [
 *     drizzleDb({
 *       driver: "postgres",
 *       url: process.env.DATABASE_URL,
 *       schemaPath: "./db/schema.ts",
 *       migrationsPath: "./db/migrations",
 *     }),
 *   ],
 * });
 * ```
 *
 * @public
 */
export function drizzleDb(opts: DrizzleDbOptions): DrizzleDbPlugin {
  const resolved = resolveOptions(opts)
  return {
    name: '@theokit/plugin-db-drizzle',
    kind: 'db',
    options: resolved,
    register(app: TheoPluginApp): void {
      // Wire CLI verbs under the canonical `db` namespace. EC-4 conflict
      // guard: if orm already registered a `db` namespace, EXTEND it
      // instead of replacing — preserves orm's existing 6 verbs while
      // adding plugin-specific ones (e.g., `seed`).
      if (app.registerCliCommand) {
        const commands = buildDbCommands(resolved)
        // #171 (EC-4): when the `db` namespace already exists (e.g. @theokit/orm
        // registered it), we EXTEND it with the drizzle verbs (the runner merges
        // late entries). Make the conflict path observably different from the
        // fresh path — warn the operator so a silent namespace collision can't
        // hide which layer owns which verbs — instead of two identical branches.
        if (app.hasCliCommand?.('db')) {
          console.warn(
            "[plugin-db-drizzle] CLI namespace 'db' is already registered — extending it with the drizzle verbs (generate/migrate/push/studio/reset/seed/check).",
          )
        }
        app.registerCliCommand('db', commands)
      }
      // Devtools-tab opt-in. Graceful no-op when overlay (G4) absent OR
      // user passed `devtoolsTab: false`.
      if (resolved.devtoolsTab && app.registerDevtoolsTab) {
        app.registerDevtoolsTab(buildDevtoolsTab(resolved))
      }
    },
  }
}
