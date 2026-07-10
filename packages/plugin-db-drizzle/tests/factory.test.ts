/**
 * RED tests for P#5 T1.2 — drizzleDb factory
 *
 * Per plan p5-plugin-db-drizzle v1.0 § Phase 1 / T1.2.
 * Blueprint Form 4 Hybrid — plugin shape entry: drizzleDb(opts): TheoPlugin
 */
import { describe, expect, it } from 'vitest'

import { drizzleDb } from '../src/index.js'

describe('drizzleDb factory (P#5 T1.2)', () => {
  it('should accept all driver values (sqlite/postgres/mysql)', () => {
    // Given: each canonical driver value
    const sqlite = drizzleDb({ driver: 'sqlite', url: ':memory:' })
    const postgres = drizzleDb({ driver: 'postgres', url: 'postgres://localhost/x' })
    const mysql = drizzleDb({ driver: 'mysql', url: 'mysql://localhost/x' })

    // Then: factory returns valid TheoPlugin shape for each
    expect(sqlite.name).toBe('@theokit/plugin-db-drizzle')
    expect(postgres.kind).toBe('db')
    expect(typeof mysql.register).toBe('function')
  })

  it("should set kind='db' on the returned plugin", () => {
    // Given: a minimal sqlite plugin
    const plugin = drizzleDb({ driver: 'sqlite', url: ':memory:' })

    // Then: plugin discriminator is the canonical 'db' kind
    expect(plugin.kind).toBe('db')
  })

  it('should set name=@theokit/plugin-db-drizzle on the returned plugin', () => {
    // Given: a minimal sqlite plugin
    const plugin = drizzleDb({ driver: 'sqlite', url: ':memory:' })

    // Then: plugin name matches npm package name (single source of truth)
    expect(plugin.name).toBe('@theokit/plugin-db-drizzle')
  })

  it('should apply default schemaPath=./db/schema.ts and migrationsPath=./db/migrations', () => {
    // Given: a plugin without schemaPath/migrationsPath
    const plugin = drizzleDb({ driver: 'sqlite', url: ':memory:' })

    // Then: defaults are applied to plugin.options for downstream consumption
    expect(plugin.options?.schemaPath).toBe('./db/schema.ts')
    expect(plugin.options?.migrationsPath).toBe('./db/migrations')
  })

  it('should default devtoolsTab=true when omitted', () => {
    // Given: a plugin without explicit devtoolsTab opt-out
    const plugin = drizzleDb({ driver: 'sqlite', url: ':memory:' })

    // Then: devtools-tab opt-in is the default behavior
    expect(plugin.options?.devtoolsTab).toBe(true)
  })

  it('should preserve user-provided devtoolsTab=false opt-out', () => {
    // Given: a plugin with explicit devtools-tab disabled
    const plugin = drizzleDb({
      driver: 'sqlite',
      url: ':memory:',
      devtoolsTab: false,
    })

    // Then: the opt-out is preserved verbatim
    expect(plugin.options?.devtoolsTab).toBe(false)
  })

  it('should preserve user-provided schemaPath and migrationsPath', () => {
    // Given: explicit path overrides
    const plugin = drizzleDb({
      driver: 'postgres',
      url: 'postgres://localhost/x',
      schemaPath: './custom/schema.ts',
      migrationsPath: './custom/migrations',
    })

    // Then: user paths take precedence over defaults
    expect(plugin.options?.schemaPath).toBe('./custom/schema.ts')
    expect(plugin.options?.migrationsPath).toBe('./custom/migrations')
  })

  it('should reject missing driver via TypeScript type error (compile-time enforcement)', () => {
    // Given: a runtime instance with missing required driver field
    // When: factory called with cast (simulating user bypassing TS)
    const plugin = drizzleDb(
      // @ts-expect-error — driver is required by DrizzleDbOptions
      { url: ':memory:' },
    )

    // Then: factory does NOT throw at runtime (TS enforces at compile time);
    // the resulting plugin's options.driver is undefined (caller's bug at runtime)
    expect(plugin.options?.driver).toBeUndefined()
  })
})
