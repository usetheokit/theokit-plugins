/**
 * @theokit/plugin-db-drizzle — option shapes.
 *
 * Per plan p5-plugin-db-drizzle v1.0 § Phase 1 / T1.2 + blueprint Form 4 Hybrid.
 */

/** Canonical driver names — covered by drizzle-kit + @theokit/orm. */
export type DrizzleDriver = 'sqlite' | 'postgres' | 'mysql'

/**
 * User-facing options for the `drizzleDb()` factory. Extends @theokit/orm's
 * shape so consumers can pass orm-specific options through the same surface
 * without double-config.
 */
export interface DrizzleDbOptions {
  /** Canonical driver name. Required. */
  driver: DrizzleDriver
  /**
   * Connection URL. Defaults to `process.env.DATABASE_URL` when omitted at
   * register-time. Plugin does not read env here — caller chooses.
   */
  url?: string
  /**
   * Path to the user's schema file (consumed by drizzle-kit).
   * Default: `./db/schema.ts`.
   */
  schemaPath?: string
  /**
   * Path to the migrations directory (consumed by drizzle-kit).
   * Default: `./db/migrations`.
   */
  migrationsPath?: string
  /**
   * Enable devtools-tab registration when @theokit overlay (G4) is detected.
   * Default: `true`. Pass `false` to suppress the tab entirely.
   */
  devtoolsTab?: boolean
  /**
   * Host for the drizzle-kit studio devtools iframe (#207). Default `localhost`.
   */
  studioHost?: string
  /**
   * Port for the drizzle-kit studio devtools iframe (#207). Default `4983`
   * (drizzle-kit's default) — only used when unset.
   */
  studioPort?: number
  /**
   * Path to the user's seed script run by `db seed` (#170). `drizzle-kit` has
   * no `seed` verb, so seeding runs THIS script. Typically resolved at
   * register-time from `package.json#theokit.db.seed`; can also be set here.
   * When unset, `db seed` errors instead of invoking a nonexistent subcommand.
   */
  seedScript?: string
}

/**
 * Fully-resolved options after defaults applied. Returned on `plugin.options`
 * so tests + downstream consumers (CLI, register) can introspect.
 */
export interface ResolvedDrizzleDbOptions {
  readonly driver: DrizzleDriver | undefined
  readonly url: string | undefined
  readonly schemaPath: string
  readonly migrationsPath: string
  readonly devtoolsTab: boolean
  readonly seedScript: string | undefined
  readonly studioHost: string
  readonly studioPort: number
}

const DEFAULT_SCHEMA_PATH = './db/schema.ts'
const DEFAULT_MIGRATIONS_PATH = './db/migrations'

/**
 * Apply defaults to user-provided options. Pure; no I/O.
 *
 * - `schemaPath` -> "./db/schema.ts"
 * - `migrationsPath` -> "./db/migrations"
 * - `devtoolsTab` -> `true`
 *
 * `driver` and `url` are passed through unchanged (caller is responsible).
 */
export function resolveOptions(opts: DrizzleDbOptions): ResolvedDrizzleDbOptions {
  return {
    driver: opts.driver,
    url: opts.url,
    schemaPath: opts.schemaPath ?? DEFAULT_SCHEMA_PATH,
    migrationsPath: opts.migrationsPath ?? DEFAULT_MIGRATIONS_PATH,
    devtoolsTab: opts.devtoolsTab ?? true,
    seedScript: opts.seedScript,
    studioHost: opts.studioHost ?? 'localhost',
    studioPort: opts.studioPort ?? 4983,
  }
}
