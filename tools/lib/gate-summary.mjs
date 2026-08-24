#!/usr/bin/env node
// One place that decides whether a gate may report success, and says what it skipped.
//
// WHY THIS EXISTS. Five gates in this repository print a line at the end of a run. Three of them
// were written to print it unconditionally, were caught one at a time by three different reviewers,
// and were each repaired in place with a comment saying `Never unconditional`. The knowledge was
// correct and it was written three times, in prose, in three files — so it reached no fourth file,
// and two other gates never received it at all.
//
// Measured 2026-08-24, by running them rather than reading them:
//
//   check-orphan-docblocks.mjs, file list forced empty:
//     [doc-orphans] PASS — no docblock is stranded above another docblock.   (exit 0)
//
//   check-doc-coverage.mjs, no packages:
//     [doc-coverage] overall 0/0 = 0.0% (floor 100%)
//     [doc-coverage] PASS — every published entry is at or above the 100% floor.
//
// The second is the shape worth naming: two `console.log` calls that contradict each other, neither
// wrong on its own terms. That is why this takes ONE input and emits the WHOLE report — "did we
// pass" and "what did we skip" stop being two decisions that can disagree.
//
// THE DISTINCTION THE GATES KEPT LOSING. "I found nothing wrong" and "I checked something" are
// different claims. A gate guarded only by the first passes on an empty input set, and its green is
// indistinguishable from a real one. Only the second is a pass.
//
// WHAT THIS CANNOT DO. It cannot tell whether the count it is handed is honest. A gate that examines
// nothing and passes `checked: 12` satisfies this helper completely. That is judgement, and a
// mechanism claiming otherwise would be the same unearned confidence this file exists to remove.

/**
 * Report a gate's outcome. Returns `true` when the gate may be considered passing.
 *
 * @param {{ label: string, subject: string, checked: number, skipped?: string[] }} report
 * @returns {boolean}
 */
export function reportGate({ label, subject, checked, skipped = [] }) {
  if (!Number.isInteger(checked) || checked < 0) {
    // Not coerced to zero on purpose. Coercion would turn an arithmetic bug in a caller into
    // "checked nothing", which is a quieter and much harder failure to trace than a loud one.
    throw new TypeError(
      `[${label}] checked must be a non-negative integer, received ${String(checked)}`,
    )
  }

  // Printed on both paths, deliberately: a skip is worth reporting most when everything else
  // passed, because that is when nobody is looking.
  for (const line of skipped) console.error(`      ℹ ${line}`)

  if (checked === 0) {
    console.error(
      `[${label}] DID NOT RUN — no ${subject} were checked, so this gate establishes nothing. ` +
        `A pass here would be indistinguishable from a real one.`,
    )
    return false
  }

  console.log(`[${label}] PASS — ${checked} ${subject} checked.`)
  return true
}

/**
 * `reportGate`, then exit. The shape most gates want.
 *
 * @param {{ label: string, subject: string, checked: number, skipped?: string[] }} report
 * @returns {never}
 */
export function reportGateAndExit(report) {
  process.exit(reportGate(report) ? 0 : 1)
}
