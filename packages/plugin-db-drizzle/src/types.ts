/**
 * @theokit/plugin-db-drizzle — runtime types.
 *
 * Per plan p5-plugin-db-drizzle v1.0. TheoPlugin shape is structurally
 * declared here to keep peerDep on `theokit` minimal — at runtime the
 * plugin runner inside theokit accepts any object with this shape via
 * duck-typing. When theokit is installed alongside, its TheoPlugin type
 * is assignable to this one.
 */

import type { TheoApp, TheoPlugin } from 'theokit/server'

import type { ResolvedDrizzleDbOptions } from './options.js'

export type { TheoApp, TheoPlugin }

// A locally invented `TheoPluginApp` used to live here, declaring
// `registerModule`, `registerCliCommand`, `registerDevtoolsTab` and
// `hasCliCommand`. None of the four exists on the framework's `TheoApp`, and it
// type-checked anyway because TypeScript is structural (#42). Worse than in the
// sibling packages: this plugin's `register()` actually CALLED them, so the
// documented CLI verbs and devtools tab were a silent no-op (#43).
//
// `import type` is erased at build, so importing the real contract costs nothing
// at runtime and the compiler checks it.

/**
 * The plugin shape this package emits. Mirrors theokit's `TheoPlugin` SDK
 * (ADR-0008 in theokit) but kept local to avoid runtime coupling.
 */
export interface DrizzleDbPlugin extends TheoPlugin {
  readonly name: '@theokit/plugin-db-drizzle'
  readonly kind: 'db'
  readonly options: ResolvedDrizzleDbOptions
  register: (app: TheoApp) => void
}
