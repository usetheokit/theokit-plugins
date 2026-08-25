/**
 * The wiring the package tells a consumer to write produces a COMPLETE argv.
 *
 * `register()` is empty and points the consumer at `buildDbCommands` — "wire it into a package
 * script of your own" — without naming where its argument comes from. It takes
 * `ResolvedDrizzleDbOptions`: ten required fields, no optionals, and no exported resolver.
 *
 * So the obvious move is to write the options object by hand, and that fails silently. Measured
 * while wiring exactly this into a demo app, and pinned below: an object missing `configPath`
 * builds
 *
 *     ["migrate", "--config", undefined]
 *
 * — the slot after the flag holds the JS value `undefined`, not a string and not nothing. No type
 * error at runtime and no diagnostic from anything on this side. What drizzle-kit does when handed
 * that is not measured here and is not claimed. The argv is wrong in exactly the one place a
 * hand-written object is short, which is why it survives a casual read.
 *
 * `drizzleDb(...)` already returns the resolved shape on `.options`. That is the documented source
 * now, and this pins it: every verb's argv, built the documented way, is complete.
 *
 * It asserts the SHAPE of the argv, which theokit-plugins#48 correctly says proves nothing about
 * whether drizzle-kit accepts it. That is not what this guards. #48's failure was flags the tool
 * rejects; this one is a flag with no value, which is visible in the argv itself and is exactly
 * what a consumer following the docs produces.
 */
import { describe, expect, it } from 'vitest'

import { buildDbCommands, drizzleDb } from '../src/index.js'

/** The documented path: the same call `theo.config.ts` makes, read back resolved. */
const OPTIONS = drizzleDb({
  driver: 'sqlite',
  url: 'file:./.data/app.db',
  schemaPath: './server/schema.ts',
}).options

describe('the documented wiring', () => {
  const commands = buildDbCommands(OPTIONS)

  // The two `user-script` verbs are excluded here and asserted below instead: with no script
  // configured they THROW rather than build an argv, which is the right answer and not what this
  // block is measuring.
  const toolDriven = commands.filter((c) => c.kind !== 'user-script')

  it('covers every verb — as a complete argv or as a named refusal', () => {
    // Without this the split silently stops covering a verb the day one is added.
    expect(toolDriven.length + commands.filter((c) => c.kind === 'user-script').length).toBe(
      commands.length,
    )
    expect(toolDriven.length).toBeGreaterThan(0)
  })

  it.each(toolDriven.map((c) => [c.verb, c] as const))(
    '%s builds an argv with no missing value',
    (verb, command) => {
      const argv = command.buildArgs()

      for (const [i, arg] of argv.entries()) {
        expect(arg, `${verb}: argv[${String(i)}] is not a string`).toBeTypeOf('string')
        expect(arg, `${verb}: argv[${String(i)}] is empty`).not.toBe('')
        expect(arg, `${verb}: argv[${String(i)}] stringified an undefined`).not.toContain(
          'undefined',
        )
      }

      // A flag is either `--name value` or `--name=value`. A `--name` followed by another flag —
      // or by nothing — is the shape a short options object produces.
      for (const [i, arg] of argv.entries()) {
        if (!arg.startsWith('--') || arg.includes('=')) continue
        const next = argv[i + 1]
        expect(next, `${verb}: ${arg} is the last argument, so it carries no value`).toBeDefined()
        expect(next?.startsWith('--'), `${verb}: ${arg} is followed by ${String(next)}`).toBe(false)
      }
    },
  )

  // The trap the docblock warns about, measured rather than asserted.
  //
  // Without this the warning is a sentence: the block above proves the DOCUMENTED path is complete
  // and says nothing about what the undocumented one produces, so a reader has only my word that
  // hand-writing the object is dangerous. `rules/testing.md § 4.1` calls this the negative lens —
  // the suite had the edge case and not its counterpart.
  it('a hand-written options object short by one field produces a flag with no value', () => {
    // Exactly what a consumer writes when they read "wire buildDbCommands into a script" and build
    // the argument themselves: every field they can think of, missing the one they cannot.
    const { configPath: _omitted, ...short } = OPTIONS
    const migrate = buildDbCommands(short as typeof OPTIONS).find((c) => c.verb === 'migrate')
    expect(migrate, 'no migrate verb to measure').toBeDefined()

    const argv = migrate!.buildArgs()
    const configIndex = argv.indexOf('--config')
    expect(configIndex, '--config is not in the argv at all').toBeGreaterThanOrEqual(0)

    // Measured: `["migrate", "--config", undefined]`. The slot after the flag holds the JS value
    // `undefined` — not the string "undefined", and not nothing. The array's LENGTH still counts it,
    // so the flag does not merely dangle at the end; it carries a hole.
    expect(argv[configIndex + 1]).toBeUndefined()
    expect(argv).toHaveLength(configIndex + 2)

    // The pair, not a duplicate: the same argv fails the positive block's own assertion, which is
    // what makes that block a guard rather than a description.
    expect(typeof argv[configIndex + 1]).not.toBe('string')
  })

  // The other half of the contract. `seed` and `reset` have no drizzle-kit subcommand to fall back
  // to, so an unconfigured script is refused by name rather than turned into an argv that would run
  // something else — `rules/error-handling.md`, fail fast and fail clear.
  it.each(commands.filter((c) => c.kind === 'user-script').map((c) => [c.verb, c] as const))(
    '%s refuses to build without its script, naming what to set',
    (verb, command) => {
      expect(() => command.buildArgs()).toThrow(new RegExp(`db ${verb}: no ${verb} script`))
      expect(() => command.buildArgs()).toThrow(/drizzleDb\(\.\.\.\)|package\.json/)
    },
  )
})
