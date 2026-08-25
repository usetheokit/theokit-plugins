/**
 * `buildArgs` takes no argument, because it reads none.
 *
 * The interface declared `buildArgs(opts: ResolvedDrizzleDbOptions)` while the implementation was a
 * zero-argument closure over the options handed to `buildDbCommands`. So the parameter was accepted
 * and discarded: a caller who resolved their config a second time and passed the fresh copy got an
 * argv built from the first one, with nothing anywhere reporting the drop.
 *
 * Measured before the change — one command built from a sqlite config, then `buildArgs` called
 * three ways:
 *
 *     passing a postgresql config → ["generate","--dialect","sqlite","--schema","./s.ts",…]
 *     passing {}                  → identical
 *     passing nothing             → identical
 *
 * The dialect stayed `sqlite` when handed postgres. This pins the honest signature so the type
 * cannot drift back into promising an influence it does not have (#170).
 */
import { describe, expect, it } from 'vitest'

import { buildDbCommands, drizzleDb } from '../src/index.js'

const sqlite = drizzleDb({
  driver: 'sqlite',
  url: 'file:./a.db',
  schemaPath: './s.ts',
}).options

describe('buildArgs', () => {
  it('builds from the options given to buildDbCommands', () => {
    const generate = buildDbCommands(sqlite).find((c) => c.verb === 'generate')
    expect(generate?.buildArgs()).toEqual([
      'generate',
      '--dialect',
      'sqlite',
      '--schema',
      './s.ts',
      '--out',
      './db/migrations',
    ])
  })

  it('accepts no argument — the signature matches what the body reads', () => {
    const generate = buildDbCommands(sqlite).find((c) => c.verb === 'generate')
    // The type is the assertion. A `buildArgs(opts)` signature makes the line below a compile
    // error, which is the point: `expect(fn.length)` would pass against either signature, since a
    // closure declaring a parameter it ignores still reports `length === 0` only by accident of how
    // it was written. The compiler is the only thing that can hold this.
    const call: () => string[] = () => generate!.buildArgs()
    expect(call()).toHaveLength(7)
  })
})
