/**
 * @theokit/plugin-db-drizzle — runtime types.
 *
 * Per plan p5-plugin-db-drizzle v1.0. TheoPlugin shape is structurally
 * declared here to keep peerDep on `theokit` minimal — at runtime the
 * plugin runner inside theokit accepts any object with this shape via
 * duck-typing. When theokit is installed alongside, its TheoPlugin type
 * is assignable to this one.
 */

import type { ResolvedDrizzleDbOptions } from './options.js'

/** Minimal app surface the plugin's `register()` needs. */
export interface TheoPluginApp {
  /** Register a DI module (e.g., `OrmModule.forRoot()`). Optional — graceful no-op when absent. */
  registerModule?: (module: unknown) => void
  /** Register a CLI subcommand namespace (e.g., 'db' with the 7 verbs). */
  registerCliCommand?: (namespace: string, commands: unknown) => void
  /** Register a devtools-overlay tab (G4 backward-compat hook). */
  registerDevtoolsTab?: (tab: unknown) => void
  /** Test whether a CLI namespace is already registered (EC-4 conflict guard). */
  hasCliCommand?: (namespace: string) => boolean
}

/**
 * The plugin shape this package emits. Mirrors theokit's `TheoPlugin` SDK
 * (ADR-0008 in theokit) but kept local to avoid runtime coupling.
 */
export interface DrizzleDbPlugin {
  readonly name: '@theokit/plugin-db-drizzle'
  readonly kind: 'db'
  readonly options: ResolvedDrizzleDbOptions
  register: (app: TheoPluginApp) => void
}
