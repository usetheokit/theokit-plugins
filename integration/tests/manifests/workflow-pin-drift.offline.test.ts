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
 * WHAT IT COMPARES CHANGED ON 2026-09-05, and the reason matters more than the mechanism. Both
 * workflows moved their toolchain onto `usetheokit/shared-workflows/actions/setup@v1`, so the pnpm
 * and Node pins that used to be copied by hand into both files now live in ONE place and cannot
 * drift at all. That removes most of the risk this file was written for — the dry run went from
 * four hand-copied SHAs to one.
 *
 * It also creates a NEW surface with the same shape: a shared action is referenced by a ref, and
 * `setup@v1` in one file with `setup@v2` in the other drifts exactly as two SHAs did. So the
 * comparison now covers BOTH — SHA-pinned actions and shared-action refs — and the vacuity guards
 * count the union. Narrowing the check to what survived would have quietly stopped watching the
 * half that replaced it.
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

/**
 * The one action both files MUST reference, named rather than counted. It is what decides which
 * pnpm and which Node everything else in the job runs on, so a dry run that sets it up differently
 * is not rehearsing the release regardless of what else agrees.
 */
const SETUP_ACTION = 'usetheokit/shared-workflows/actions/setup'

/**
 * `{ 'actions/checkout': '3d3c42e…', 'usetheokit/shared-workflows/actions/setup': 'v1' }` for every
 * `uses:` whose version can drift between the two files.
 *
 * Two forms, both included deliberately. A 40-hex SHA is the classic hand-copied pin. A shared
 * action referenced by `@v1` is the form that replaced most of them — it cannot drift in WHAT IT
 * RUNS, since that lives in one repository, but the two workflows can still name different refs,
 * which is the same defect wearing different clothes. Matching only the first would have left the
 * check watching the shrinking half.
 */
function pins(file: string): Map<string, string> {
  const text = readFileSync(join(WORKFLOWS, file), 'utf8')
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const sha = /^\s*-?\s*uses:\s*([^@\s]+)@([0-9a-f]{40})\b/.exec(line)
    if (sha !== null) {
      out.set(sha[1]!, sha[2]!)
      continue
    }
    const shared = /^\s*-?\s*uses:\s*(usetheokit\/shared-workflows\/[^@\s]+)@(\S+)/.exec(line)
    if (shared !== null) out.set(shared[1]!, shared[2]!)
  }
  return out
}

describe('the release dry run pins what the release pins', () => {
  const release = pins('release.yml')
  const dryRun = pins('release-dryrun.yml')

  it('finds versions in both, so the comparison below cannot pass vacuously', () => {
    // An empty map means the regexes stopped matching, and an empty-vs-empty comparison agrees
    // perfectly while checking nothing.
    //
    // NO HARD-CODED COUNT. The previous version required more than two entries each, calibrated
    // to a dry run that hand-copied four SHAs. Moving the toolchain onto a shared action left it
    // with two, and a threshold that fails on a correct change teaches people to edit the
    // threshold. What is asserted instead is the thing that must be true: both name the setup
    // action, which is what makes the dry run a rehearsal rather than a different job.
    expect(release.size).toBeGreaterThan(0)
    expect(dryRun.size).toBeGreaterThan(0)
    expect(
      [...release.keys()],
      'release.yml does not reference the shared setup action',
    ).toContain(SETUP_ACTION)
    expect(
      [...dryRun.keys()],
      'the dry run does not set its toolchain up the way the release does',
    ).toContain(SETUP_ACTION)
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
    // Asserting the setup action by name rather than a count, for the reason given above.
    expect(
      shared,
      'the two workflows share no versioned action — has one been rewritten?',
    ).toContain(SETUP_ACTION)
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
