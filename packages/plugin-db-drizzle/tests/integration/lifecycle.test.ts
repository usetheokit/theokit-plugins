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

  it('CLI verbs produce drizzle-kit-compatible args for sqlite in-memory', () => {
    const plugin = drizzleDb({
      driver: 'sqlite',
      url: ':memory:',
      schemaPath: './db/schema.ts',
      migrationsPath: './db/migrations',
    })

    // Called directly. Reaching these through `register()` required a mock app
    // implementing methods that do not exist, so the old route to this assertion
    // was longer AND less true.
    const cmds = buildDbCommands(plugin.options)

    const migrate = cmds.find((c) => c.verb === 'migrate')
    expect(migrate).toBeDefined()
    const migrateArgs = migrate?.buildArgs(plugin.options) ?? []
    expect(migrateArgs[0]).toBe('migrate')
    expect(migrateArgs).toContain('./db/schema.ts')

    const generate = cmds.find((c) => c.verb === 'generate')
    const generateArgs = generate?.buildArgs(plugin.options) ?? []
    expect(generateArgs).toContain('--out')
    expect(generateArgs).toContain('./db/migrations')
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
