/**
 * The release dry run must pin the same action versions the real release pins.
 *
 * `.github/workflows/release-dryrun.yml` exists to make a change to the release path verifiable
 * before it reaches `main`, and its entire value rests on running what `release.yml` runs. Four
 * action SHAs are copied by hand, and until this existed the only thing holding them together was a
 * comment saying "when you bump a pin there, bump it here".
 *
 * A note is not a check. If the two drift, the dry run goes GREEN on a commit the real release
 * rejects — worse than having no dry run, because it produces confidence it has not earned. This
 * repository has paid for that shape before: the `pnpm version` reserved-word trap left a step that
 * "still looked like it had worked" for two months across five releases.
 *
 * WHAT THIS DOES NOT COMPARE, and cannot without interpreting the YAML: the gate STEPS. Whether the
 * dry run runs the same `pnpm typecheck` and `pnpm test` the release runs is a question about what
 * a `run:` block means, not about what a `uses:` line says. A check that silently covered half the
 * drift would be the problem this file is about, so the half it does not cover is named here and in
 * its own assertion message rather than left implied.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows')

/** `{ 'actions/checkout': '3d3c42e…' }` for every SHA-pinned `uses:` in a workflow. */
function pins(file: string): Map<string, string> {
  const text = readFileSync(join(WORKFLOWS, file), 'utf8')
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^\s*-?\s*uses:\s*([^@\s]+)@([0-9a-f]{40})\b/.exec(line)
    if (match !== null) out.set(match[1]!, match[2]!)
  }
  return out
}

describe('the release dry run pins what the release pins', () => {
  const release = pins('release.yml')
  const dryRun = pins('release-dryrun.yml')

  it('finds pins in both, so the comparison below cannot pass vacuously', () => {
    // Both files SHA-pin everything, so an empty map means the regex stopped matching — and an
    // empty-vs-empty comparison agrees perfectly while checking nothing.
    expect(release.size).toBeGreaterThan(2)
    expect(dryRun.size).toBeGreaterThan(2)
  })

  it('agrees on every action both use', () => {
    const shared = [...dryRun.keys()].filter((action) => release.has(action)).sort()
    const drifted = shared
      .filter((action) => dryRun.get(action) !== release.get(action))
      .map(
        (action) =>
          `${action}: release.yml pins ${release.get(action)!.slice(0, 12)}…, ` +
          `release-dryrun.yml pins ${dryRun.get(action)!.slice(0, 12)}…`,
      )

    expect(
      drifted,
      'the dry run would exercise a different toolchain than the release it exists to rehearse',
    ).toEqual([])
    // Not a formality: if the two shared nothing, the assertion above passes over an empty set.
    expect(
      shared.length,
      'the two workflows share no pinned action — has one been rewritten?',
    ).toBeGreaterThan(2)
  })

  it('does not pin an action the release does not use', () => {
    // The other direction. A dry run reaching for a tool the release never runs is rehearsing
    // something else, and the failure would be invisible to the comparison above.
    const extra = [...dryRun.keys()].filter((action) => !release.has(action)).sort()

    expect(
      extra,
      'the dry run uses an action the release does not — it is rehearsing a different job',
    ).toEqual([])
  })
})
