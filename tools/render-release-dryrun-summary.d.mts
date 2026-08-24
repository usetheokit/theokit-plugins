/**
 * Types for `render-release-dryrun-summary.mjs`, which stays plain JS because it runs from a
 * workflow step where no build has necessarily happened yet. Same arrangement as
 * `tools/lib/markdown-fences.d.mts`.
 */

export interface ReleaseDryRunSummaryIo {
  /** Path `changeset status --output` wrote to. Absent is an error, never an empty release. */
  statusFile: string
  /** Path to append the markdown to — `$GITHUB_STEP_SUMMARY` in the workflow. */
  summaryFile: string
}

/** Appends the summary and returns how many packages would be released. */
export function renderReleaseDryRunSummary(io: ReleaseDryRunSummaryIo): number
