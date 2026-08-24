/**
 * The dry run's summary renderer must tell "nothing to release" apart from "the step did not run".
 *
 * This repository has already paid for that confusion once: `release.yml` carries the record of a
 * version step that "still looked like it had worked" for two months, because a no-op and a
 * success rendered identically. An empty markdown table has exactly that shape — a header, no
 * rows, and no way to tell which of the two produced it.
 *
 * So the renderer lives here rather than inline in the workflow. A `run:` block is not unit
 * testable, and the one case worth testing is the empty one, which nobody dispatches on purpose.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { renderReleaseDryRunSummary } from '../../../tools/render-release-dryrun-summary.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Writes a status payload to a scratch file and renders it, returning the markdown produced. */
function render(payload: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dryrun-'))
  const statusFile = join(dir, 'changeset-status.json')
  const summaryFile = join(dir, 'summary.md')
  writeFileSync(statusFile, JSON.stringify(payload))
  writeFileSync(summaryFile, '')
  renderReleaseDryRunSummary({ statusFile, summaryFile })
  return readFileSync(summaryFile, 'utf8')
}

describe('the release dry run reports what it found', () => {
  it('says nothing is pending rather than drawing an empty table', () => {
    const summary = render({ changesets: [], releases: [] })

    expect(summary).toContain('Nothing to release')
    // The discriminator, not decoration: a table header with no rows is what a step that never
    // ran would also produce, and the whole point of this renderer is that the two differ.
    expect(summary).not.toContain('| Package |')
  })

  it('renders one row per package, with the version it would move to', () => {
    const summary = render({
      changesets: ['a'],
      releases: [
        { name: '@theokit/plugin-forms', type: 'minor', oldVersion: '0.3.0', newVersion: '0.4.0' },
        {
          name: '@theokit/plugin-copilot',
          type: 'patch',
          oldVersion: '0.3.0',
          newVersion: '0.3.1',
        },
      ],
    })

    expect(summary).toContain('Would release 2 package(s)')
    expect(summary).toContain('`@theokit/plugin-forms` | minor | 0.3.0 | **0.4.0**')
    expect(summary).toContain('`@theokit/plugin-copilot` | patch | 0.3.0 | **0.3.1**')
  })

  it('throws when the status file is absent, instead of reporting an empty release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dryrun-'))

    // The dangerous combination the plan's EC-3 names: a missing file silently becoming
    // "nothing to release" would report a broken dry run as a clean one.
    expect(() =>
      renderReleaseDryRunSummary({
        statusFile: join(dir, 'does-not-exist.json'),
        summaryFile: join(dir, 'summary.md'),
      }),
    ).toThrow(/changeset status wrote no output/i)
  })

  it('is the renderer the workflow actually calls', () => {
    // Without this, the tests above could pass forever against a module the dry run stopped
    // using — the same self-report gap the seam suite exists to close.
    const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/release-dryrun.yml'), 'utf8')

    expect(workflow).toContain('tools/render-release-dryrun-summary.mjs')
  })
})
