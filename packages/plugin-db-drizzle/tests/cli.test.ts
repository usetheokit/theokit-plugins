/**
 * RED tests for P#5 T2.1 — CLI verb wiring
 *
 * Per plan p5-plugin-db-drizzle v1.0 § Phase 2 / T2.1. 7 verbs:
 * generate/migrate/push/studio/reset/seed/check.
 *
 * Tests assert the buildArgs() factory shapes; child_process spawn is NOT
 * exercised here (integration-test territory).
 */
import { describe, expect, it } from 'vitest'

import { buildDbCommands, type DbVerb } from '../src/cli/db.js'
import { resolveOptions } from '../src/options.js'

const REQUIRED_VERBS: readonly DbVerb[] = [
  'generate',
  'migrate',
  'push',
  'studio',
  'reset',
  'seed',
  'check',
]

describe('buildDbCommands (P#5 T2.1) — 7 verbs', () => {
  it('emits exactly 7 commands covering canonical verb set', () => {
    // Given: resolved opts
    const opts = resolveOptions({ driver: 'sqlite', url: ':memory:' })

    // When: commands built
    const cmds = buildDbCommands(opts)

    // Then: each canonical verb is present
    expect(cmds).toHaveLength(7)
    const verbs = cmds.map((c) => c.verb).sort()
    expect(verbs).toEqual([...REQUIRED_VERBS].sort())
  })

  it('includes a human-readable summary per verb', () => {
    const opts = resolveOptions({ driver: 'sqlite', url: ':memory:' })

    // Then: every command has a non-empty summary
    for (const cmd of buildDbCommands(opts)) {
      expect(cmd.summary.length).toBeGreaterThan(10)
    }
  })

  it('passes --schema to exactly the verbs drizzle-kit accepts it on (#48)', () => {
    // This assertion used to demand `--schema` on EVERY drizzle-kit verb. That is
    // not the real grammar: `migrate`, `studio` and `check` reject it, so the old
    // expectation is what kept five broken verbs looking covered.
    const opts = resolveOptions({
      driver: 'postgres',
      url: 'postgres://x',
      schemaPath: './custom/schema.ts',
    })

    const takesSchema = new Set<DbVerb>(['generate', 'push'])
    for (const cmd of buildDbCommands(opts).filter((c) => c.kind !== 'user-script')) {
      const args = cmd.buildArgs(opts)
      expect(args[0]).toBe(cmd.verb)
      if (takesSchema.has(cmd.verb)) {
        expect(args, `${cmd.verb} takes --schema`).toContain('--schema')
        expect(args).toContain('./custom/schema.ts')
      } else {
        expect(args, `drizzle-kit rejects --schema on ${cmd.verb}`).not.toContain('--schema')
      }
    }
  })

  it('generate verb additionally passes --out pointing at migrationsPath', () => {
    // Given: opts with explicit migrationsPath
    const opts = resolveOptions({
      driver: 'postgres',
      url: 'postgres://x',
      migrationsPath: './drizzle/migrations',
    })

    const cmds = buildDbCommands(opts)
    const generate = cmds.find((c) => c.verb === 'generate')

    // Then: generate's args contain --out with the custom path
    expect(generate).toBeDefined()
    const args = generate?.buildArgs(opts) ?? []
    expect(args).toContain('--out')
    expect(args).toContain('./drizzle/migrations')
  })

  it('test_seed_runs_user_script (#170)', () => {
    // `drizzle-kit seed` does not exist — seed must run the user's configured
    // script, flagged kind:"user-script" so the runner spawns it as a script.
    const opts = resolveOptions({ driver: 'sqlite', url: ':memory:', seedScript: './db/seed.ts' })
    const seed = buildDbCommands(opts).find((c) => c.verb === 'seed')!
    expect(seed.kind).toBe('user-script')
    const args = seed.buildArgs(opts)
    expect(args).toContain('./db/seed.ts')
    // NOT the old drizzle-kit passthrough shape.
    expect(args).not.toContain('seed')
    expect(args).not.toContain('--schema')
  })

  it('test_seed_throws_when_no_script_configured (#170)', () => {
    const opts = resolveOptions({ driver: 'sqlite', url: ':memory:' }) // no seedScript
    const seed = buildDbCommands(opts).find((c) => c.verb === 'seed')!
    expect(() => seed.buildArgs(opts)).toThrow(/seed.*script/i)
  })

  it('declares the kind each verb actually needs (#48)', () => {
    // Three kinds, because drizzle-kit offers three shapes: flags, config-only,
    // and no subcommand at all. Collapsing them into one is what spawned
    // `drizzle-kit reset` — a command that exists in no version.
    const opts = resolveOptions({ driver: 'sqlite', url: 'file:app.db' })
    const kind = (v: DbVerb) => buildDbCommands(opts).find((c) => c.verb === v)?.kind

    for (const verb of ['generate', 'push', 'check'] as DbVerb[]) {
      expect(kind(verb), `${verb} is driven by flags`).toBe('drizzle-kit')
    }
    for (const verb of ['migrate', 'studio'] as DbVerb[]) {
      expect(kind(verb), `${verb} accepts only --config`).toBe('drizzle-kit-with-config')
    }
    for (const verb of ['seed', 'reset'] as DbVerb[]) {
      expect(kind(verb), `drizzle-kit has no ${verb} subcommand`).toBe('user-script')
    }
  })

  it('forwards --url only to push, the one verb that accepts it (#48)', () => {
    // `migrate`/`studio` reject --url and --dialect (config-only); `check` takes
    // --dialect but not --url. Only `push` takes both.
    const opts = resolveOptions({ driver: 'postgres', url: 'postgres://h/db' })
    const argsOf = (v: DbVerb) =>
      buildDbCommands(opts)
        .find((c) => c.verb === v)!
        .buildArgs(opts)

    const push = argsOf('push')
    expect(push).toContain('--dialect')
    expect(push).toContain('postgresql') // driver → dialect mapped (NOT --driver)
    expect(push).toContain('--url')
    expect(push).toContain('postgres://h/db')

    // `check` takes the dialect, never the url.
    expect(argsOf('check')).toContain('--dialect')
    expect(argsOf('check')).not.toContain('--url')

    // The connection reaches the config-only verbs through the rendered config.
    for (const verb of ['migrate', 'studio'] as DbVerb[]) {
      expect(argsOf(verb)).not.toContain('--url')
      expect(argsOf(verb)).toContain('--config')
    }
  })

  it('generate takes --dialect but never --url (#48)', () => {
    // Inverted deliberately. The old assertion demanded NO --dialect on
    // `generate`, citing "it only diffs the schema" — drizzle-kit makes dialect a
    // REQUIRED param of generate and refuses the command without it.
    const opts = resolveOptions({ driver: 'postgres', url: 'postgres://h/db' })
    const args = buildDbCommands(opts)
      .find((c) => c.verb === 'generate')!
      .buildArgs(opts)
    expect(args, 'generate refuses to run without a dialect').toContain('--dialect')
    expect(args).toContain('postgresql')
    expect(args, 'generate never opens a connection').not.toContain('--url')
  })

  it('omits --url when url is undefined (no corrupt arg vector) (#169)', () => {
    const opts = resolveOptions({ driver: 'sqlite' }) // url omitted
    // `push` is the verb that carries --url now; `migrate` is config-only (#48).
    const args = buildDbCommands(opts)
      .find((c) => c.verb === 'push')!
      .buildArgs(opts)
    expect(args).not.toContain('--url')
    expect(args).toContain('--dialect')
    expect(args).toContain('sqlite')
  })

  it('test_reset_requires_force (#168)', () => {
    // The destructive `reset` verb must be FLAGGED as force-requiring so the
    // runner refuses it without --force. (Enforcement is runner-side; here we
    // assert the descriptor carries the guard signal — currently absent.)
    const opts = resolveOptions({ driver: 'sqlite', url: ':memory:' })
    const reset = buildDbCommands(opts).find((c) => c.verb === 'reset')
    expect(reset?.requiresForce).toBe(true)
    const migrate = buildDbCommands(opts).find((c) => c.verb === 'migrate')
    expect(migrate?.requiresForce ?? false).toBe(false)
  })

  it('non-generate verbs do NOT include --out flag', () => {
    const opts = resolveOptions({
      driver: 'sqlite',
      url: ':memory:',
      migrationsPath: './drizzle/migrations',
    })

    // `check` reads the migrations folder to verify it, so it takes --out too
    // (#48) — the old list asserted otherwise and matched no real grammar.
    for (const verb of ['migrate', 'push', 'studio'] as DbVerb[]) {
      const cmd = buildDbCommands(opts).find((c) => c.verb === verb)
      const args = cmd?.buildArgs(opts) ?? []
      expect(args, `${verb} takes no --out`).not.toContain('--out')
    }
    const check = buildDbCommands(opts)
      .find((c) => c.verb === 'check')!
      .buildArgs(opts)
    expect(check, 'check verifies the migrations folder').toContain('--out')
    expect(check).toContain('./drizzle/migrations')
  })
})
