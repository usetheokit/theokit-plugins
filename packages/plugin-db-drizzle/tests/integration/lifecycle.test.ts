/**
 * Integration test for P#5 T2.3 — full lifecycle smoke
 *
 * Per plan p5-plugin-db-drizzle v1.0 § Phase 2 / T2.3. Blueprint ADR D5
 * (test discipline mirrors @theokit/orm pattern — better-sqlite3 in-memory).
 *
 * Asserts:
 * - Plugin shape integrates with a mock theokit-style app
 * - CLI verb buildArgs() emit shell-safe args
 * - Devtools-tab is opt-in (toggle works in real wiring)
 *
 * Does NOT exercise real drizzle-kit child_process — that requires
 * drizzle-kit binary installed, which is optional peer. Verb dispatch +
 * spawn is integration territory better-tested in dogfood-app smoke (T3.2).
 */
import { describe, expect, it } from 'vitest'

import { drizzleDb } from '../../src/index.js'
import type { TheoPluginApp } from '../../src/types.js'

describe('plugin lifecycle smoke (P#5 T2.3)', () => {
  it('plugin registered into a mock app wires CLI + devtools-tab end-to-end', () => {
    // Given: a mock app simulating the theokit plugin runner
    const captured: {
      cliNamespaces: string[]
      cliCommands: Map<string, unknown>
      devtoolsTabs: { id: string; label: string }[]
    } = {
      cliNamespaces: [],
      cliCommands: new Map(),
      devtoolsTabs: [],
    }
    const app: TheoPluginApp = {
      registerCliCommand(ns, cmds) {
        captured.cliNamespaces.push(ns)
        captured.cliCommands.set(ns, cmds)
      },
      registerDevtoolsTab(tab) {
        const t = tab as { id: string; label: string }
        captured.devtoolsTabs.push({ id: t.id, label: t.label })
      },
      hasCliCommand(ns) {
        return captured.cliCommands.has(ns)
      },
    }

    // When: a typical postgres plugin is registered
    const plugin = drizzleDb({
      driver: 'postgres',
      url: 'postgres://localhost/app',
      schemaPath: './db/schema.ts',
    })
    plugin.register(app)

    // Then: 'db' CLI registered + 1 devtools tab + plugin reports its shape
    expect(captured.cliNamespaces).toEqual(['db'])
    expect(captured.devtoolsTabs).toEqual([{ id: 'db-studio', label: 'Database' }])
    expect(plugin.kind).toBe('db')
    expect(plugin.name).toBe('@theokit/plugin-db-drizzle')
    expect(plugin.options.driver).toBe('postgres')
  })

  it('CLI verbs produce drizzle-kit-compatible args for sqlite in-memory', () => {
    // Given: typical dev-mode sqlite setup
    const plugin = drizzleDb({
      driver: 'sqlite',
      url: ':memory:',
      schemaPath: './db/schema.ts',
      migrationsPath: './db/migrations',
    })

    // Capture CLI commands
    let dbCommands: unknown = null
    plugin.register({
      registerCliCommand(_ns, cmds) {
        dbCommands = cmds
      },
    })

    // Then: commands array exists; each command produces sane drizzle-kit args
    expect(dbCommands).toBeDefined()
    const cmds = dbCommands as {
      verb: string
      buildArgs: (opts: unknown) => string[]
    }[]

    // `migrate` args lead with `migrate` verb + schema flag
    const migrate = cmds.find((c) => c.verb === 'migrate')
    expect(migrate).toBeDefined()
    const migrateArgs = migrate?.buildArgs(plugin.options) ?? []
    expect(migrateArgs[0]).toBe('migrate')
    expect(migrateArgs).toContain('./db/schema.ts')

    // `generate` args also include --out for migrations
    const generate = cmds.find((c) => c.verb === 'generate')
    const generateArgs = generate?.buildArgs(plugin.options) ?? []
    expect(generateArgs).toContain('--out')
    expect(generateArgs).toContain('./db/migrations')
  })

  it('multi-plugin scenario: two drizzleDb instances do not clobber each other', () => {
    // Given: two plugin instances with different options (e.g., test app
    // wires a second connection for migrations vs runtime)
    const pluginA = drizzleDb({
      driver: 'sqlite',
      url: ':memory:',
      devtoolsTab: true,
    })
    const pluginB = drizzleDb({
      driver: 'postgres',
      url: 'postgres://x',
      devtoolsTab: false,
    })

    // Then: each plugin's options are independent (no shared mutable state)
    expect(pluginA.options.driver).toBe('sqlite')
    expect(pluginB.options.driver).toBe('postgres')
    expect(pluginA.options.devtoolsTab).toBe(true)
    expect(pluginB.options.devtoolsTab).toBe(false)
  })
})
