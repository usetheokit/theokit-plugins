/**
 * Full-lifecycle smoke, re-rooted on the API that exists.
 *
 * The previous version of this file built "a mock app simulating the theokit
 * plugin runner" whose methods — `registerCliCommand`, `registerDevtoolsTab`,
 * `hasCliCommand` — the real runner does not have (#42). A test named
 * "wires CLI + devtools-tab end-to-end" therefore asserted against a fiction: it
 * confirmed the fabrication instead of catching it, which is why seven dead CLI
 * verbs looked covered (#43).
 *
 * The assertions worth keeping are kept, re-rooted:
 *
 *   buildArgs shape          now reads `buildDbCommands` directly, which is both
 *                            honest and stronger — no wiring in the way
 *   per-instance isolation   never touched the fabrication; unchanged
 *
 * The end-to-end wiring claim is gone, because there is no wiring to claim.
 * `tests/adapter.test.ts` asserts what `register()` does against the real
 * `TheoApp`: nothing, deliberately.
 */
import { describe, expect, it } from 'vitest'

import { buildDbCommands, drizzleDb } from '../../src/index.js'

describe('plugin lifecycle smoke', () => {
  it('reports its own shape', () => {
    const plugin = drizzleDb({
      driver: 'postgres',
      url: 'postgres://localhost/app',
      schemaPath: './db/schema.ts',
    })

    expect(plugin.kind).toBe('db')
    expect(plugin.name).toBe('@theokit/plugin-db-drizzle')
    expect(plugin.options.driver).toBe('postgres')
  })

  it("the caller's paths reach the commands the plugin builds", () => {
    // Renamed from "produce drizzle-kit-compatible args", which this test could
    // never establish: it never consulted drizzle-kit, and the args it blessed
    // were rejected by the real binary on five of six verbs (#48). Compatibility
    // is now asserted where it can be — `tests/integration/drizzle-kit-grammar.test.ts`
    // spawns the actual drizzle-kit. What is left here is the narrower, honest
    // claim: options given to `drizzleDb()` are the ones the commands carry.
    const plugin = drizzleDb({
      driver: 'sqlite',
      url: 'file:app.db',
      schemaPath: './db/schema.ts',
      migrationsPath: './db/migrations',
    })

    // Called directly. Reaching these through `register()` required a mock app
    // implementing methods that do not exist, so the old route to this assertion
    // was longer AND less true.
    const cmds = buildDbCommands(plugin.options)
    const argsOf = (verb: string) => {
      const cmd = cmds.find((c) => c.verb === verb)
      expect(cmd, `${verb} missing`).toBeDefined()
      return cmd?.buildArgs(plugin.options) ?? []
    }

    const generate = argsOf('generate')
    expect(generate[0]).toBe('generate')
    expect(generate).toContain('./db/schema.ts')
    expect(generate).toContain('./db/migrations')

    // `migrate` carries the config path instead of the paths themselves — they
    // travel inside the rendered config (#48).
    const migrate = argsOf('migrate')
    expect(migrate[0]).toBe('migrate')
    expect(migrate).toContain(plugin.options.configPath)
  })

  it('multi-plugin scenario: two drizzleDb instances do not clobber each other', () => {
    const pluginA = drizzleDb({ driver: 'sqlite', url: ':memory:', devtoolsTab: true })
    const pluginB = drizzleDb({ driver: 'postgres', url: 'postgres://x', devtoolsTab: false })

    expect(pluginA.options.driver).toBe('sqlite')
    expect(pluginB.options.driver).toBe('postgres')
    expect(pluginA.options.devtoolsTab).toBe(true)
    expect(pluginB.options.devtoolsTab).toBe(false)
  })
})
