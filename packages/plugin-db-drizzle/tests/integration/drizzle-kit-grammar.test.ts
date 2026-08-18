/**
 * The args we build, handed to the drizzle-kit that will actually receive them.
 *
 * Every other test in this package asserts the SHAPE of `buildArgs()` — that it
 * returns `['generate', '--schema', …]`. That is a comparison against our own
 * expectation, and it passes just as happily when the flag is one drizzle-kit
 * rejects. Six verbs were asserted that way; five of them do not run.
 *
 * So this suite asks the only question that decides whether `theokit db <verb>`
 * works for a user: does the real binary ACCEPT what we emit, and does the
 * database change when it should?
 *
 * It asserts outcomes, never flag names. A fix is free to reach the outcome
 * through `--config`, through explicit flags, or any other way drizzle-kit
 * supports — the test stays valid because it never encoded the mechanism.
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { buildDbCommands, renderDrizzleConfig } from '../../src/cli/db.js'
import { resolveOptions, type DrizzleDbOptions } from '../../src/options.js'

const here = dirname(fileURLToPath(import.meta.url))
const DRIZZLE_KIT = join(here, '../../node_modules/.bin/drizzle-kit')

/** The three ways drizzle-kit refuses a command line it cannot run. */
const REFUSALS = [
  /Unrecognized options? for command/i,
  /Please provide required params/i,
  /Unknown command/i,
]

/**
 * Verbs that reach the real binary. `seed` and `reset` do not: drizzle-kit has
 * neither subcommand, so both run a script the user supplies (#48, #170).
 */
const PASSTHROUGH = ['generate', 'migrate', 'push', 'studio', 'check'] as const

const OPTIONS: DrizzleDbOptions = {
  driver: 'sqlite',
  url: 'file:app.db',
  schemaPath: './db/schema.ts',
  migrationsPath: './db/migrations',
  // Deliberately NOT drizzle-kit's default (4983): it omits the port from the
  // URL it prints when the port is the default, so a default here would make the
  // "did our port arrive?" assertion below unfalsifiable.
  studioPort: 45_987,
}

/**
 * A throwaway project with the schema in place.
 *
 * One per test, deliberately. Sharing it made the round-trip below vacuous: the
 * `push` case in the loop applies the schema to the same `app.db`, so `users`
 * already existed by the time `migrate` was asserted to have created it — the
 * assertion would have stayed green through a total `migrate` regression.
 */
function newProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theokit-drizzle-'))
  mkdirSync(join(dir, 'db'))
  writeFileSync(
    join(dir, 'db/schema.ts'),
    [
      "import { sqliteTable, text } from 'drizzle-orm/sqlite-core'",
      '',
      "export const users = sqliteTable('users', {",
      "  id: text('id').primaryKey(),",
      "  email: text('email').notNull(),",
      '})',
      '',
    ].join('\n'),
  )
  return dir
}

function run(
  project: string,
  args: readonly string[],
  timeout = 60_000,
): { out: string; refused: string | undefined } {
  let out: string
  try {
    out = execFileSync(DRIZZLE_KIT, [...args], {
      cwd: project,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    })
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    out = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message}`
  }
  const hit = REFUSALS.find((r) => r.test(out))
  const refused = hit === undefined ? undefined : (out.split('\n').find((l) => hit.test(l)) ?? out)
  return { out, refused }
}

/**
 * Run a verb that never exits on its own, and stop as soon as it has said the
 * thing we are asking about.
 *
 * `studio` is a server. Waiting out a fixed timeout instead would put that whole
 * duration on every CI run, and shortening the timeout to compensate would trade
 * the tax for a flake on a slow machine. Killing on the match costs neither: the
 * ceiling is only reached when the line never comes, which is the failure.
 */
async function runUntil(
  project: string,
  args: readonly string[],
  pattern: RegExp,
  ceiling = 45_000,
): Promise<{ out: string; refused: string | undefined }> {
  const child = spawn(DRIZZLE_KIT, [...args], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  const done = new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      child.kill('SIGKILL')
      resolve()
    }
    const timer = setTimeout(finish, ceiling)
    const onChunk = (c: Buffer) => {
      out += c.toString('utf8')
      if (pattern.test(out) || REFUSALS.some((r) => r.test(out))) finish()
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('exit', finish)
    child.on('error', finish)
  })
  await done
  const hit = REFUSALS.find((r) => r.test(out))
  const refused = hit === undefined ? undefined : (out.split('\n').find((l) => hit.test(l)) ?? out)
  return { out, refused }
}

/**
 * Play the runner: for `kind:"drizzle-kit-with-config"` the descriptor requires
 * the config to be on disk before spawning, so write exactly what the plugin
 * renders, at exactly the path it declares. Inventing either would make the
 * test prove something the runner does not do.
 */
function argsFor(project: string, verb: string): string[] {
  const resolved = resolveOptions(OPTIONS)
  const cmd = buildDbCommands(resolved).find((c) => c.verb === verb)
  if (cmd === undefined) throw new Error(`${verb} missing from buildDbCommands`)
  if (cmd.kind === 'drizzle-kit-with-config') {
    const target = join(project, resolved.configPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, renderDrizzleConfig(resolved))
  }
  return cmd.buildArgs(resolved)
}

describe('the args we emit are a command line drizzle-kit accepts', () => {
  for (const verb of PASSTHROUGH) {
    it(`${verb} is not refused by the real binary`, { timeout: 60_000 }, async () => {
      const resolved = resolveOptions(OPTIONS)
      const cmd = buildDbCommands(resolved).find((c) => c.verb === verb)
      expect(cmd, `${verb} missing from buildDbCommands`).toBeDefined()
      expect(cmd?.kind, `${verb} must reach the real binary somehow`).toMatch(
        /^drizzle-kit(-with-config)?$/,
      )

      const project = newProject()
      const args = argsFor(project, verb)
      // `studio` never exits; the rest complete on their own in well under a second.
      const { out, refused } =
        verb === 'studio' ? await runUntil(project, args, /up and running/i) : run(project, args)
      expect(refused, `drizzle-kit refused our ${verb} args — ${refused}`).toBeUndefined()

      // Absence of a refusal is weak evidence on its own: a binary that died
      // before parsing would also produce it. For the config-only verbs, demand
      // the positive signal that it read OUR config at OUR declared path —
      // drizzle-kit prints that line only after accepting the command line.
      if (cmd?.kind === 'drizzle-kit-with-config') {
        expect(out, `${verb} never read the config we wrote`).toMatch(
          /Reading config file .*\.theokit[/\\]drizzle\.config\.ts/,
        )
      }

      // #49: `studio` used to stop being provable here — it died right after
      // reading the config because `drizzle-orm@0.36` does not export
      // `./singlestore-core`, which drizzle-kit imports. Asserting only "not
      // refused" left a broken verb looking covered, so demand that it actually
      // came up, and that it came up on OUR host and port.
      if (verb === 'studio') {
        expect(out, 'studio never reported itself as running').toMatch(/up and running/i)
        expect(out, 'studio ignored the host/port we passed').toMatch(/port=45987.*host=localhost/)
      }
    })
  }
})

describe('the database actually changes', () => {
  it(
    'generate writes a migration, and migrate applies it to a real sqlite file',
    { timeout: 60_000 },
    () => {
      const project = newProject()
      const gen = run(project, argsFor(project, 'generate'))
      expect(gen.refused, `generate refused — ${gen.refused}`).toBeUndefined()

      const migrationsDir = join(project, 'db/migrations')
      expect(existsSync(migrationsDir), 'generate produced no migrations directory').toBe(true)
      expect(
        readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).length,
        'generate produced no .sql migration',
      ).toBeGreaterThan(0)

      const mig = run(project, argsFor(project, 'migrate'))
      expect(mig.refused, `migrate refused — ${mig.refused}`).toBeUndefined()

      // The claim under test is "applied to the database", so read the database.
      const db = new Database(join(project, 'app.db'), { readonly: true })
      const found = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .all('users')
      db.close()
      expect(found.length, 'migrate did not create the users table in the real database').toBe(1)
    },
  )
})
