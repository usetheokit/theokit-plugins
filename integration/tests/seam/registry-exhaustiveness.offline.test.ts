/**
 * Every package under `packages/` declares which seam it integrates through.
 *
 * B-001's third DoD bullet asks that a package integrating through neither seam be "exempt by
 * an explicit declaration, not by silence". The difference between the two is only whether
 * something checks — a comment in a test file is a declaration nobody verifies, and the next
 * package added would be exempt by being forgotten. This file is that check.
 *
 * It reads the filesystem and never imports a package, so a broken package cannot make the
 * exhaustiveness assertion fail for an unrelated reason.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { INTEGRATING_PACKAGES, MANIFEST_LESS_DIRECTORIES } from '../../src/integrating-packages.js'

/**
 * The repo root, resolved from THIS file rather than from `process.cwd()`.
 *
 * The suite runs as `pnpm --filter @theokit/plugins-integration offline`, so vitest's cwd is
 * `integration/`. A bare `packages/` glob would resolve to `integration/packages/`, which does
 * not exist — and a check written as "every package found on disk is registered" would then
 * pass vacuously over an empty set, rebuilding exemption-by-silence inside the test meant to
 * stop it.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

/** Directory names under `packages/`, whether or not they carry a manifest. */
function directoriesOnDisk(): string[] {
  return readdirSync(PACKAGES_DIR).filter((name) =>
    statSync(join(PACKAGES_DIR, name)).isDirectory(),
  )
}

function hasManifest(name: string): boolean {
  try {
    readFileSync(join(PACKAGES_DIR, name, 'package.json'), 'utf8')
    return true
  } catch (err) {
    // ENOENT only. Swallowing every fs error would reclassify a real package as manifest-less on
    // EACCES or EISDIR, and the failure would then surface at the skip assertion below as
    // `expected [plugin-mdx, plugin-x] to equal [plugin-mdx]` — pointing at the wrong problem.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

describe('the seam registry covers every package on disk', () => {
  it('finds the real packages directory, not an empty one', () => {
    // Guards the vacuous-pass path above: if this ever reads the wrong root, every other
    // assertion in this file becomes a comparison between two empty sets.
    expect(directoriesOnDisk(), `no directories under ${PACKAGES_DIR}`).not.toHaveLength(0)
    expect(directoriesOnDisk()).toContain('plugin-payments')
  })

  it('lists every package that has a manifest', () => {
    const onDisk = directoriesOnDisk().filter(hasManifest).sort()
    const registered = INTEGRATING_PACKAGES.map((entry) => entry.pkg).sort()

    // Set equality in BOTH directions. A missing row means a package nobody checks; a stale row
    // means the registry describes a repository that no longer exists. Neither is acceptable.
    expect(registered).toEqual(onDisk)
  })

  it('gives every seamless package a written reason', () => {
    // Deliberately NOT `expect(seamless).not.toHaveLength(0)`: that would encode "at least one
    // package must always be seam-less" as a permanent requirement, and go red on the desirable
    // end state where every package has a seam. The guard wanted is that each exempt row carries
    // a reason, which an empty loop satisfies vacuously and correctly.
    const seamless = INTEGRATING_PACKAGES.filter((entry) => entry.seam === 'none')

    for (const entry of seamless) {
      expect(entry.reason, `${entry.pkg} is exempt with no reason`).toBeTruthy()
      // Trimmed, so 21 spaces no longer passes what looks like a quality gate, and word-counted
      // rather than character-counted: the property wanted is "a sentence a reviewer can
      // disagree with", and length alone was only ever a proxy for it.
      expect(
        entry.reason!.trim().split(/\s+/).length,
        `${entry.pkg}'s reason is too short to disagree with: ${entry.reason}`,
      ).toBeGreaterThanOrEqual(8)
    }
  })

  it('skips a directory that has no manifest, and says which one', () => {
    // `plugin-mdx` holds only `.gitkeep` (rules/cycle-backlog.md § Packages that exist and take
    // no items). Asserting the skip keeps it a measured fact rather than a filter nobody reviewed
    // — if a manifest ever lands there, this test fails and the registry must gain a row.
    const skipped = directoriesOnDisk()
      .filter((name) => !hasManifest(name))
      .sort()

    expect(skipped).toEqual([...MANIFEST_LESS_DIRECTORIES].sort())
  })
})
