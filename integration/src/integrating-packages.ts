/**
 * Which seam each package integrates through.
 *
 * TheoKit offers exactly two runtime surfaces a package here can plug into:
 *
 *   - the **plugin seam** — `createPluginRunnerFromConfig` from `theokit/server/plugins`, whose
 *     `isPlugin` requires an object with a non-empty `name` string and a `register` function,
 *     then runs `register` against a child scope built with `Object.create()`;
 *   - the **auth seam** — `defineAuth({ session, providers })` from `@theokit/sdk/server/auth`.
 *
 * A package that plugs into neither says so here, with a reason. That is the point of the file:
 * `registry-exhaustiveness.offline.test.ts` reads `packages/` from disk and fails when a package
 * is missing, so no package can be exempt merely by never being mentioned.
 *
 * This module holds declarations, not inference. Deriving the seam from each `package.json`
 * would be tempting and wrong — that inference is what the conformance suites exist to test, so
 * a registry that computed it would agree with itself by construction.
 */

/** The runtime surface a package hands its export to, or `none`. */
export type Seam = 'plugin' | 'auth' | 'none'

export interface IntegratingPackage {
  /** Directory name under `packages/` — not the npm name. */
  readonly pkg: string
  readonly seam: Seam
  /** Required when `seam` is `'none'`: why this package plugs into neither surface. */
  readonly reason?: string
  /**
   * The exported function whose result goes into the seam — `copilot()`, not `defineCopilot()`.
   *
   * Required when `seam` is not `'none'`, and absent when it is. `pnpm check:manifests` looks for
   * this name in the package's README: a package that declares a seam and never documents the
   * function that reaches it leaves a consumer with an integration that looks wired and is not.
   * Measured on `plugin-copilot`, whose README contained zero occurrences of `copilot(`.
   */
  readonly factory?: string
  /**
   * Repo-relative path to a conformance case that lives outside `integration/tests/seam/`.
   *
   * Set this ONLY when a package is exercised somewhere else. The conformance suites drive
   * themselves from this array, so a row with a seam and neither a local case nor this pointer
   * fails — which is what makes the registry load-bearing rather than a list.
   *
   * Be clear about what a pointer proves: that a case is CLAIMED at a path which exists. It does
   * not prove the case still hands the export to the seam. Local coverage is strictly stronger,
   * and a pointer is the right trade only when the local fixture would cost more than it earns.
   */
  readonly coveredBy?: string
}

export const INTEGRATING_PACKAGES: readonly IntegratingPackage[] = Object.freeze([
  // --- plugin seam: exports an object with { name, register } ---
  {
    pkg: 'plugin-copilot',
    seam: 'plugin',
    factory: 'copilot',
    // Covered in its own package rather than here: `defineCopilot` needs zod schemas, and zod is
    // not a dependency of this workspace. Duplicating the fixture would mean a new devDependency
    // plus ~20 lines to re-assert what that file already asserts.
    coveredBy: 'packages/plugin-copilot/tests/integration/plugin-runner-conformance.test.ts',
  },
  { pkg: 'plugin-db-drizzle', seam: 'plugin', factory: 'drizzleDb' },
  { pkg: 'plugin-payments', seam: 'plugin', factory: 'payments' },
  { pkg: 'plugin-voice', seam: 'plugin', factory: 'voicePlugin' },

  // --- auth seam: exports a provider that defineAuth drives ---
  { pkg: 'auth-github', seam: 'auth', factory: 'github' },
  { pkg: 'auth-google', seam: 'auth', factory: 'google' },
  { pkg: 'auth-magic-link', seam: 'auth', factory: 'magicLink' },

  // --- neither: declared, not omitted ---
  {
    pkg: 'plugin-canvas',
    seam: 'none',
    reason:
      'Exports a ./server surface but no plugin object: nothing here has { name, register }, and it defines no auth provider.',
  },
  {
    pkg: 'plugin-email',
    seam: 'none',
    reason:
      'Owns its own contract — src/provider.ts imports EmailProvider from ./types.js, not from theokit. There is no framework surface to hand it to.',
  },
  {
    pkg: 'plugin-forms',
    seam: 'none',
    reason:
      'Declares neither theokit nor @theokit/sdk. It integrates through React and Zod, which are not seams this registry describes.',
  },
  {
    pkg: 'plugin-realtime',
    seam: 'none',
    reason:
      'Defines its own provider contract and never imports theokit/server/realtime, whose only export is ChannelManager.',
  },
])

/**
 * Directories under `packages/` that carry no `package.json`.
 *
 * `plugin-mdx` holds only `.gitkeep` — named in `rules/cycle-backlog.md § Packages that exist and
 * take no items` so its absence reads as deliberate. Listing it here rather than filtering
 * silently means a manifest landing there turns the exhaustiveness suite red, which is the
 * moment someone should decide which seam it uses.
 */
export const MANIFEST_LESS_DIRECTORIES: readonly string[] = Object.freeze(['plugin-mdx'])
