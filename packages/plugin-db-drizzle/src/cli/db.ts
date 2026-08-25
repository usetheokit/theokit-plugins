/**
 * @theokit/plugin-db-drizzle — CLI subcommands.
 *
 * Per plan p5-plugin-db-drizzle v1.0 § Phase 2 / T2.1. Ships 7 verbs under
 * the canonical `db` namespace: generate/migrate/push/studio/reset/seed/check.
 *
 * Each verb spawns drizzle-kit via Node child_process (D2 blueprint ADR —
 * passthrough pattern; mirrors wasp's `runStudio` 4-line implementation).
 *
 * `drizzle-kit` is an OPTIONAL peer per package.json — runtime apps that
 * never invoke CLI don't need it installed. Each verb gates on the binary's
 * presence with an actionable error message.
 */

import type { DrizzleDriver, ResolvedDrizzleDbOptions } from '../options.js'

/** Per-verb command descriptor. The runner reads these to dispatch CLI args. */
export interface DbCommand {
  readonly verb: DbVerb
  readonly summary: string
  /**
   * How the runner executes this verb.
   *
   * - `"drizzle-kit"` — spawn `drizzle-kit` with `buildArgs()`.
   * - `"drizzle-kit-with-config"` — `drizzle-kit` accepts ONLY `--config` for
   *   this verb, measured against 0.31.10 (#48). The runner MUST write
   *   `renderDrizzleConfig(opts)` to `opts.configPath` and then spawn. Skipping
   *   the write leaves `--config` pointing at nothing.
   * - `"user-script"` — run the user's script (`buildArgs()` returns its path);
   *   drizzle-kit has no such subcommand.
   */
  readonly kind: 'drizzle-kit' | 'drizzle-kit-with-config' | 'user-script'
  /**
   * Destructive verb the runner MUST gate behind an explicit `--force`
   * flag before executing. Enforcement lives in the CLI runner (it has the
   * user's argv); this descriptor only declares the requirement.
   */
  readonly requiresForce?: boolean
  /**
   * Build the drizzle-kit args array for this verb.
   *
   * Takes nothing. It closes over the options handed to `buildDbCommands`, and used to DECLARE a
   * `ResolvedDrizzleDbOptions` parameter it never read — so a caller who resolved their config
   * twice and passed the fresh copy got an argv built from the first, silently. Measured: handing
   * it a postgresql config produced an argv still saying `--dialect sqlite` (#170).
   *
   * Removing the parameter is a breaking change at the type level, and the right one: the argument
   * has never had an effect, and a compile error is how a caller finds that out.
   */
  buildArgs(): string[]
}

/** The canonical 7-verb set per plan ADR D3. */
export type DbVerb = 'generate' | 'migrate' | 'push' | 'studio' | 'reset' | 'seed' | 'check'

const VERBS: readonly DbVerb[] = [
  'generate',
  'migrate',
  'push',
  'studio',
  'reset',
  'seed',
  'check',
] as const

/**
 * Build the 7 CLI commands from resolved plugin options.
 *
 * Pure factory — no spawn here. The runner inside theokit's plugin runtime
 * calls `cmd.buildArgs()` then spawns drizzle-kit. The options reach the argv through THIS call's
 * argument and nowhere else; `buildArgs` takes none (#170).
 */
export function buildDbCommands(opts: ResolvedDrizzleDbOptions): DbCommand[] {
  return VERBS.map((verb) => ({
    verb,
    summary: SUMMARIES[verb],
    kind: kindOf(verb),
    // `reset` is destructive (drops the DB) — the runner must require --force.
    ...(verb === 'reset' ? { requiresForce: true } : {}),
    buildArgs: () => {
      // #48: drizzle-kit has neither a `seed` nor a `reset` subcommand, so
      // both run a script the user supplies.
      if (verb === 'seed') return scriptArgs('seed', opts.seedScript)
      if (verb === 'reset') return scriptArgs('reset', opts.resetScript)
      return baseArgs(verb, opts)
    },
  }))
}

function kindOf(verb: DbVerb): DbCommand['kind'] {
  if (verb === 'seed' || verb === 'reset') return 'user-script'
  if (CONFIG_ONLY_VERBS.has(verb)) return 'drizzle-kit-with-config'
  return 'drizzle-kit'
}

const SUMMARIES: Record<DbVerb, string> = {
  generate: 'Generate a new migration file from schema diff (drizzle-kit generate).',
  migrate: 'Apply pending migrations to the database (drizzle-kit migrate).',
  push: 'Push schema directly to the database (dev-only, drizzle-kit push).',
  studio: 'Open the drizzle-kit visual database explorer.',
  reset: 'Drop the database, drop all tables, and re-apply all migrations. Requires --force.',
  seed: 'Run the user-provided seed script (package.json#theokit.db.seed).',
  check: 'Check schema drift between code and database.',
}

/**
 * The verbs drizzle-kit does not have: `seed` and `reset` (#48). Both run
 * a script the user supplies, returned as the sole arg for `kind:"user-script"`.
 *
 * Fails loud when unconfigured. `reset` used to be spawned as
 * `drizzle-kit reset`, a subcommand that does not exist in any version — the
 * error a user got named drizzle-kit rather than the missing setting.
 */
function scriptArgs(verb: 'seed' | 'reset', script: string | undefined): string[] {
  if (script === undefined || script.length === 0) {
    throw new Error(
      `db ${verb}: no ${verb} script configured. Set \`${verb}Script\` on drizzleDb(...) ` +
        `or \`package.json#theokit.db.${verb}\` to the path of your ${verb} script. ` +
        `drizzle-kit has no \`${verb}\` subcommand, so there is nothing to fall back to.`,
    )
  }
  return [script]
}

/** drizzle-kit's connection flag is `--dialect` (NOT `--driver`); map our driver. */
const DRIVER_TO_DIALECT: Record<DrizzleDriver, string> = {
  postgres: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite',
}

/**
 * Which flags each verb accepts — measured against `drizzle-kit@0.31.10`
 * (`drizzle-kit <verb> --help`), not inferred (#48).
 *
 * The previous version of this file applied two rules of its own invention:
 * `--schema` on every verb, and `--dialect`/`--url` on a `CONNECTION_VERBS` set.
 * Neither matches the real grammar, so five of the six passthrough verbs emitted
 * a command line drizzle-kit refuses. `tests/integration/drizzle-kit-grammar.test.ts`
 * is what holds this table to the binary: it spawns the real one per verb.
 *
 * `migrate` and `studio` are deliberately absent — they accept `--config` ONLY,
 * so neither can be driven by flags at all. See § below.
 */
const ACCEPTS: Partial<Record<DbVerb, ReadonlySet<'schema' | 'out' | 'dialect' | 'url'>>> = {
  generate: new Set(['dialect', 'schema', 'out']),
  push: new Set(['dialect', 'schema', 'url']),
  check: new Set(['dialect', 'out']),
}

/** Verbs drizzle-kit drives ONLY through `--config` — measured (#48). */
const CONFIG_ONLY_VERBS: ReadonlySet<DbVerb> = new Set(['migrate', 'studio'])

/**
 * The `drizzle.config.ts` this plugin hands to the verbs that accept nothing
 * else. Pure — returns the file's content; the runner writes it (#48).
 *
 * Synthesized from the options the caller already gave `drizzleDb(...)`, so the
 * connection is declared once. The alternative — requiring the user to maintain
 * a config beside the plugin options — lets the two diverge silently, and a
 * `migrate` run against the wrong database is the failure that costs most.
 */
export function renderDrizzleConfig(opts: ResolvedDrizzleDbOptions): string {
  if (opts.driver === undefined) {
    throw new Error('db: cannot write a drizzle config without `driver`. Set it on drizzleDb(...).')
  }
  if (opts.url === undefined) {
    throw new Error(
      'db: cannot write a drizzle config without `url`. Set it on drizzleDb(...) or pass DATABASE_URL.',
    )
  }
  return [
    '// Generated by @theokit/plugin-db-drizzle. Do not edit — it is rewritten per run.',
    "import { defineConfig } from 'drizzle-kit'",
    '',
    'export default defineConfig({',
    `  dialect: ${JSON.stringify(DRIVER_TO_DIALECT[opts.driver])},`,
    `  schema: ${JSON.stringify(opts.schemaPath)},`,
    `  out: ${JSON.stringify(opts.migrationsPath)},`,
    `  dbCredentials: { url: ${JSON.stringify(opts.url)} },`,
    '})',
    '',
  ].join('\n')
}

function configArgs(verb: DbVerb, opts: ResolvedDrizzleDbOptions): string[] {
  const args = [verb, '--config', opts.configPath]
  // `studio` is the one config-only verb that also takes flags of its own.
  if (verb === 'studio') {
    args.push('--host', opts.studioHost, '--port', String(opts.studioPort))
  }
  return args
}

function baseArgs(verb: DbVerb, opts: ResolvedDrizzleDbOptions): string[] {
  if (CONFIG_ONLY_VERBS.has(verb)) {
    return configArgs(verb, opts)
  }
  const accepts = ACCEPTS[verb]
  if (accepts === undefined) {
    throw new Error(
      `db ${verb}: drizzle-kit has no \`${verb}\` subcommand, so it cannot be a passthrough. See #48.`,
    )
  }
  const args: string[] = [verb]
  // Order follows drizzle-kit's own help output. Each flag is conditional on its
  // source being set — pushing `--url undefined` would corrupt the arg vector.
  if (accepts.has('dialect') && opts.driver !== undefined) {
    args.push('--dialect', DRIVER_TO_DIALECT[opts.driver])
  }
  if (accepts.has('schema')) {
    args.push('--schema', opts.schemaPath)
  }
  if (accepts.has('out')) {
    args.push('--out', opts.migrationsPath)
  }
  if (accepts.has('url') && opts.url !== undefined) {
    args.push('--url', opts.url)
  }
  return args
}
