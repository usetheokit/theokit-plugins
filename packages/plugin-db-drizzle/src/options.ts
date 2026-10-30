/**
 * @theokit/plugin-db-drizzle — option shapes.
 *
 * Per plan p5-plugin-db-drizzle v1.0 § Phase 1 / T1.2 + blueprint Form 4 Hybrid.
 */

/** Canonical driver names, mapped to drizzle-kit's `--dialect`. */
export type DrizzleDriver = 'sqlite' | 'postgres' | 'mysql'

/**
 * User-facing options for the `drizzleDb()` factory. Every field feeds the
 * drizzle-kit command lines, the generated config or the studio tab.
 */
export interface DrizzleDbOptions {
  /** Canonical driver name. Required. */
  driver: DrizzleDriver
  /**
   * Connection URL. The package never reads `process.env.DATABASE_URL`; pass
   * it here. `renderDrizzleConfig` throws when it is missing.
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
   * Carried on `options` for the consumer's own devtools wiring; nothing in
   * this package reads it or registers a tab. Default: `true`.
   */
  devtoolsTab?: boolean
  /**
   * Host for the drizzle-kit studio devtools iframe. Default `localhost`.
   */
  studioHost?: string
  /**
   * Port for the drizzle-kit studio devtools iframe. Default `4983`
   * (drizzle-kit's default) — only used when unset.
   */
  studioPort?: number
  /**
   * Path to the user's seed script run by `db seed`. `drizzle-kit` has
   * no `seed` verb, so seeding runs THIS script. When unset, the `seed`
   * command's `buildArgs()` throws instead of naming a nonexistent subcommand.
   */
  seedScript?: string
  /**
   * Path to the user's reset script run by `db reset` (#48). `drizzle-kit` has
   * no `reset` verb — the previous release spawned one anyway — so resetting
   * runs THIS script. When unset, `db reset` errors instead of invoking a
   * subcommand that does not exist.
   */
  resetScript?: string
  /**
   * Where the synthesized `drizzle.config.ts` is written (#48). `migrate` and
   * `studio` accept ONLY `--config`, so the plugin renders one from these
   * options and points the verb at it. Default: `./.theokit/drizzle.config.ts`.
   *
   * The file is rewritten on every run and is not meant to be edited or
   * committed — add `.theokit/` to `.gitignore`.
   */
  configPath?: string
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
  readonly resetScript: string | undefined
  readonly studioHost: string
  readonly studioPort: number
  readonly configPath: string
}

const DEFAULT_SCHEMA_PATH = './db/schema.ts'
const DEFAULT_MIGRATIONS_PATH = './db/migrations'
const DEFAULT_CONFIG_PATH = './.theokit/drizzle.config.ts'

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
    resetScript: opts.resetScript,
    studioHost: opts.studioHost ?? 'localhost',
    studioPort: opts.studioPort ?? 4983,
    configPath: opts.configPath ?? DEFAULT_CONFIG_PATH,
  }
}
