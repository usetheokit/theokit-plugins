/**
 * A package that exports a zod schema for `@Body()` must declare a zod its consumer can share.
 *
 * `@theokit/http` types the decorator against zod 4 — `Body: (keyOrSchema?: string | z.ZodType)`,
 * with `peerDependencies: { zod: "^4.0.0" }`. A plugin that declares zod under `dependencies`
 * instead of `peerDependencies` gets its own copy in the consumer's tree, its published `.d.ts`
 * resolves the bare `import { z } from 'zod'` to THAT copy, and the schema it exports is typed
 * against a zod the decorator does not accept. The documented pattern then fails to compile in
 * every consumer while compiling perfectly inside this repository, where the pair is consistent
 * (#191).
 *
 * That asymmetry is the whole reason this file exists. `pnpm typecheck` verifies each package
 * against ITS OWN resolution, which is exactly the resolution a consumer does not have — so a
 * green monorepo said nothing about the seam. The gate is on the manifest rather than on types,
 * because the manifest is what decides whether a second copy exists at all.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const packagesDir = join(repoRoot, 'packages')

interface Manifest {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function read(pkg: string): Manifest | undefined {
  const p = join(packagesDir, pkg, 'package.json')
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Manifest) : undefined
}

/**
 * Strip block and line comments before matching.
 *
 * Without this, `plugin-payments` was reported — its `webhook-controller.ts` explains in prose why
 * it deliberately does NOT take `@Body(schema)`, and the sentence saying so matched the regex
 * looking for the thing it refuses to do. The package declares no zod at all, so the gate demanded
 * a peer for a dependency that does not exist.
 *
 * This repository has paid for the same shape once already: the packaging contract's
 * module-specifier regex read `Buffer.from('crypto')` as an import and reddened every PR with a
 * fabricated BLOCKER (#84). A gate that invents a finding is worse than no gate, because someone
 * eventually "fixes" the manifest to satisfy it.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Packages whose `src/server` hands a zod schema to `@Body(...)` in code, not in prose. */
function packagesExportingSchemasToBody(): string[] {
  const out: string[] = []
  for (const pkg of readdirSync(packagesDir)) {
    const serverDir = join(packagesDir, pkg, 'src', 'server')
    if (!existsSync(serverDir)) continue
    const usesBodyWithSchema = readdirSync(serverDir)
      .filter((f) => f.endsWith('.ts'))
      .some((f) =>
        /@Body\(\s*[A-Za-z_$][\w$]*\s*\)/.test(
          stripComments(readFileSync(join(serverDir, f), 'utf8')),
        ),
      )
    if (usesBodyWithSchema) out.push(pkg)
  }
  return out
}

describe('zod across the @Body seam', () => {
  it('finds the packages the rule is about, so a rename cannot empty this suite', () => {
    // A guard that silently matches nothing is the failure mode this whole file is written about.
    expect(packagesExportingSchemasToBody().length).toBeGreaterThan(0)
  })

  it.each(packagesExportingSchemasToBody())(
    '%s declares zod as a peer, never bundling a second copy into the consumer',
    (pkg) => {
      const manifest = read(pkg)
      expect(manifest, `packages/${pkg}/package.json`).toBeDefined()
      expect(
        manifest?.dependencies?.zod,
        `packages/${pkg} declares zod under dependencies, which puts a second zod in every ` +
          `consumer's tree and makes its exported schema unusable with @Body (#191)`,
      ).toBeUndefined()
      expect(
        manifest?.peerDependencies?.zod,
        `packages/${pkg} must declare a zod peer`,
      ).toBeDefined()
    },
  )

  it.each(packagesExportingSchemasToBody())(
    '%s accepts the zod major @theokit/http types @Body against',
    (pkg) => {
      // Not cosmetic: `@theokit/http` requires ^4.0.0, so a peer range that excludes 4 leaves the
      // consumer with no version satisfying both, and the schema is unusable however it is declared.
      expect(read(pkg)?.peerDependencies?.zod ?? '').toMatch(/\^4|>=\s*4|4\.x/)
    },
  )
})
