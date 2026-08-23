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
}

export const INTEGRATING_PACKAGES: readonly IntegratingPackage[] = Object.freeze([
  // --- plugin seam: exports an object with { name, register } ---
  { pkg: 'plugin-copilot', seam: 'plugin' },
  { pkg: 'plugin-db-drizzle', seam: 'plugin' },
  { pkg: 'plugin-payments', seam: 'plugin' },
  { pkg: 'plugin-voice', seam: 'plugin' },

  // --- auth seam: exports a provider that defineAuth drives ---
  { pkg: 'auth-github', seam: 'auth' },
  { pkg: 'auth-google', seam: 'auth' },
  { pkg: 'auth-magic-link', seam: 'auth' },

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
