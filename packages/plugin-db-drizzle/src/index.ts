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

import { type DrizzleDbOptions, resolveOptions } from './options.js'
import type { DrizzleDbPlugin, TheoApp } from './types.js'

export type { DrizzleDbOptions, DrizzleDriver, ResolvedDrizzleDbOptions } from './options.js'
export type { DrizzleDbPlugin, TheoApp, TheoPlugin } from './types.js'

// Exported because the alternative is dead code. These two were reachable only
// from a `register()` that called a nonexistent API, and from their own tests —
// ~30 assertions covering something no consumer could invoke (#43). Exporting
// them is not new surface; it un-hides surface that already existed and is
// already tested.
//
// Wire it into a package script of your own, and take its argument from the plugin:
//
//     const plugin = drizzleDb({ driver: 'sqlite', url, schemaPath })  // the theo.config.ts call
//     for (const cmd of buildDbCommands(plugin.options)) …             // resolved, defaults filled
//
// `plugin.options`, NOT an object of your own. `buildDbCommands` takes the RESOLVED shape — ten
// required fields, no optionals — and a hand-written one short by a field does not fail here: it
// builds `["migrate", "--config", undefined]`, an argv whose slot after the flag holds the JS value
// `undefined`. Measured, not inferred. What the tool then does with it was NOT measured and is not
// claimed; the point is that nothing on this side objects. `drizzleDb(...)` is the only thing that
// fills the defaults, so it is the only honest source for that argument.
//
// `tests/documented-wiring-builds-a-complete-argv.test.ts` pins both halves: every verb built the
// documented way carries a complete argv, and the short object produces exactly the hole above.
export { buildDbCommands, renderDrizzleConfig, type DbCommand, type DbVerb } from './cli/db.js'
export { buildDevtoolsTab, type DrizzleDevtoolsTab } from './devtools.js'

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
    register(_app: TheoApp): void {
      // Deliberately empty, and the reason is worth stating because the previous
      // body was not.
      //
      // It called `app.registerCliCommand('db', …)` and
      // `app.registerDevtoolsTab(…)` behind `if (app.registerCliCommand)`
      // guards. Neither method exists on `TheoApp` — the framework passes
      // `addHook` and `decorateRequest`, nothing more — so the guards were
      // always false and seven documented CLI verbs plus a devtools tab were a
      // silent no-op (#43). The `theokit` CLI itself knows build / dev / doctor
      // / start and has no plugin extension point, so there was nowhere for the
      // verbs to go even had the call landed.
      //
      // Nothing replaces it here because this plugin has no runtime surface to
      // publish: `DrizzleDbPlugin` carries name/kind/options and no client. It
      // hands DATABASE_URL to the consumer's drizzle-kit and never connects,
      // which is also why `e2e/src/services.ts` excludes it from the live
      // suites. `buildDbCommands` stays tested and is exported below so a
      // consumer can wire it into their own script (#43, fix option 2) — from
      // `drizzleDb(...).options` rather than an object of their own; see the
      // export comment above for why that distinction is load-bearing.
    },
  }
}
