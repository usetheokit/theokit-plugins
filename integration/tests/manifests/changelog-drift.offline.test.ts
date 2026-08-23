/**
 * A release that shipped must be recorded, and the check must say which invariant broke.
 *
 * The root `v*` tag convention stopped at `v0.3.0` while the CHANGELOG kept recording versioned
 * releases, and five versions ended up existing only in prose. The deeper fact measured on
 * 2026-08-23: `changeset version` rewrites *package* changelogs and never touches the root one, so
 * on the day eleven packages shipped, sixty-one entries still sat under `[Unreleased]` and the
 * file said nothing had been released since 0.7.0.
 *
 * The convention died silently precisely because nothing checked. Tags are the only artefact a
 * release produces without a human, so they are what the record is compared against.
 *
 * `docs/adr/0002-the-repository-releases-packages-not-itself.md` states the two floors this deliberately does not reach: a release
 * recorded *badly* is invisible to it, and the day-granular comparison means a release and its
 * record on the same day always agree.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const TOOL = join(REPO_ROOT, 'tools', 'check-changelog-structure.mjs')

const created: string[] = []

afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true })
})

/**
 * A throwaway git repository with one CHANGELOG and, optionally, one tag.
 *
 * A real repository rather than a stub: the tool reads tag dates through `git for-each-ref`, and a
 * fake would test a different code path than the one that ships.
 */
function repo(changelog: string, tag?: { name: string; date: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'cl-drift-'))
  created.push(root)
  mkdirSync(join(root, 'tools', 'lib'), { recursive: true })
  writeFileSync(join(root, 'CHANGELOG.md'), changelog)

  const git = (args: string[], env: NodeJS.ProcessEnv = {}) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore', env: { ...process.env, ...env } })

  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.invalid'])
  git(['config', 'user.name', 'test'])
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'init', '--no-verify'])
  if (tag) {
    const stamp = `${tag.date}T12:00:00`
    git(['tag', '-a', tag.name, '-m', tag.name], {
      GIT_COMMITTER_DATE: stamp,
      GIT_AUTHOR_DATE: stamp,
    })
  }
  return root
}

/**
 * Run the tool with `ROOT` pointed at the fixture.
 *
 * The tool resolves `ROOT` from its own location, so the fixture cannot simply be a cwd — the
 * environment override is how the shipped code is exercised against a different tree.
 */
function check(root: string): { code: number; output: string } {
  const result = spawnSync('node', [TOOL], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CHANGELOG_ROOT: root },
  })
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const UNRELEASED = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- something\n\n'

describe('a release that shipped must be recorded', () => {
  it('fails when a package tag is newer than the newest dated section', () => {
    const root = repo(`${UNRELEASED}## 2026-08-01\n\nEarlier release.\n`, {
      name: '@theokit/plugin-payments@0.4.0',
      date: '2026-08-23',
    })

    const { code, output } = check(root)

    expect(code, 'a release newer than the record was accepted').toBe(1)
    expect(output).toMatch(/release-drift/)
    expect(output).toMatch(/@theokit\/plugin-payments@0\.4\.0 was tagged 2026-08-23/)
    // The pointer must be to a VERSIONED path. `.claude/` is gitignored here, so a failure
    // message citing a rule file there would resolve to nothing in a fresh clone — which is
    // exactly how the convention this replaces died.
    expect(output, 'the failure does not point at the decision').toMatch(/docs\/adr\/0002-/)
  })

  it('passes when the record is current with the newest tag', () => {
    const root = repo(`${UNRELEASED}## 2026-08-23\n\nEleven packages cut together.\n`, {
      name: '@theokit/plugin-payments@0.4.0',
      date: '2026-08-23',
    })

    expect(check(root).code).toBe(0)
  })

  it('fails when there is no dated section at all while a tag exists', () => {
    const root = repo(UNRELEASED, { name: '@theokit/plugin-voice@0.8.0', date: '2026-08-23' })

    const { code, output } = check(root)

    expect(code).toBe(1)
    expect(output).toMatch(/no dated release section/)
  })

  it('reports rather than passing silently when no tags are readable', () => {
    // A shallow clone or a tarball has no tags. Failing there would break the gate for a reason
    // unrelated to the CHANGELOG; claiming a clean check the run did not make is the defect this
    // repository keeps finding in its own gates.
    const root = repo(`${UNRELEASED}## 2026-08-01\n\nEarlier release.\n`)

    const { code, output } = check(root)

    expect(code, 'a repository with no tags was failed').toBe(0)
    expect(output, 'silently skipped instead of reporting').toMatch(/did not run/)
    // The assertion above passed while the summary still printed the clean claim on the other
    // stream — the third instance of this defect in this repository's gates. Saying it did not
    // run and claiming it passed in the same output is worse than either alone.
    expect(output, 'claimed a comparison it did not make').not.toMatch(
      /the newest release is recorded/,
    )
    expect(output).toMatch(/release drift NOT checked/)
  })

  it('names the structural problem, not the drift, when only the structure is broken', () => {
    // Two invariants share this exit code. A failure that says only "CHANGELOG problem" sends the
    // reader to guess which of two unrelated things broke.
    const root = repo(
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- one\n\n### Fixed\n\n- two\n\n### Added\n\n- three\n\n## 2026-08-23\n\nRecorded.\n',
      { name: '@theokit/plugin-voice@0.8.0', date: '2026-08-23' },
    )

    const { code, output } = check(root)

    expect(code).toBe(1)
    expect(output).toMatch(/structural problem/)
    expect(output, 'blamed drift for a structural failure').not.toMatch(/release-drift/)
  })

  it('passes against this repository', () => {
    const result = spawnSync('node', [TOOL], { cwd: REPO_ROOT, encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(`${result.stdout}`, 'reported success without checking the record').toMatch(
      /the newest release is recorded/,
    )
  })
})
