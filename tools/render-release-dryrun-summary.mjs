#!/usr/bin/env node
// Renders the release dry run's job summary from `changeset status --output`.
//
// This is a file rather than a `run:` block in `.github/workflows/release-dryrun.yml` for two
// reasons, and the second is the one that matters.
//
// The first is mechanical: a heredoc'd Node script inside YAML inside a shell trips shellcheck
// SC2016 on every JS template literal, and the honest fix for a false positive is to stop
// writing the code somewhere it cannot be read properly — not to add a suppression comment.
//
// The second: the case worth getting right is the EMPTY one, and nobody dispatches a dry run on
// purpose to see nothing happen. An empty markdown table — a header with no rows — is exactly
// what a step that never ran would also produce. This repository already paid for that shape:
// `.github/workflows/release.yml` carries the record of a version step that "still looked like
// it had worked" for two months, across five releases. A `run:` block cannot be unit tested;
// this module is, in `integration/tests/manifests/release-dryrun-summary.offline.test.ts`.
//
// WHAT THIS CANNOT SEE: whether the release would succeed. It reports the release that WOULD be
// computed. The permission failure B-023 records is only observable by actually opening a pull
// request, which is the opposite of a dry run.

import { appendFileSync, readFileSync } from 'node:fs'

/**
 * @param {{ statusFile: string, summaryFile: string }} io
 * @returns {number} how many packages would be released
 */
export function renderReleaseDryRunSummary({ statusFile, summaryFile }) {
  let raw
  try {
    raw = readFileSync(statusFile, 'utf8')
  } catch (err) {
    // Fail loudly rather than returning zero. A missing file rendering as "nothing to release"
    // would report a broken dry run as a clean one — a wrong answer produced by an absent input,
    // which is the worst combination available here.
    throw new Error(
      `changeset status wrote no output at ${statusFile}: ${/** @type {Error} */ (err).message}`,
    )
  }

  const { releases } = JSON.parse(raw)

  if (releases.length === 0) {
    appendFileSync(summaryFile, '## Nothing to release\n\nNo pending changesets on this branch.\n')
    return 0
  }

  const rows = releases
    .map((r) => `| \`${r.name}\` | ${r.type} | ${r.oldVersion} | **${r.newVersion}** |`)
    .join('\n')

  appendFileSync(
    summaryFile,
    `## Would release ${releases.length} package(s)\n\n` +
      '| Package | Bump | From | To |\n|---|---|---|---|\n' +
      `${rows}\n`,
  )
  return releases.length
}

// Invoked by the workflow with the two paths in the environment, so the YAML stays declarative
// and this file stays importable by the test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=tools\/)/, ''))) {
  const statusFile = process.env.STATUS_FILE
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (!statusFile || !summaryFile) {
    console.error('STATUS_FILE and GITHUB_STEP_SUMMARY must both be set')
    process.exit(2)
  }
  const count = renderReleaseDryRunSummary({ statusFile, summaryFile })
  console.log(
    count === 0
      ? 'nothing to release — no pending changesets'
      : `${count} package(s) would be released`,
  )
}
