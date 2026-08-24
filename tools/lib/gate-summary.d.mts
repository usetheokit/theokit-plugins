/**
 * Types for `gate-summary.mjs`, which stays plain JS because `tools/` has no build step. Same
 * arrangement as `tools/lib/markdown-fences.d.mts`.
 */

export interface GateReport {
  /** The bracketed prefix a reader scans for, e.g. `doc-orphans`. */
  label: string
  /** Plural noun for what was examined — appears in both the pass and the did-not-run line. */
  subject: string
  /** How many units were actually examined. Zero is never a pass. */
  checked: number
  /** Anything deliberately not examined, reported on success as well as on failure. */
  skipped?: string[]
}

/** Emits the report. `true` when the gate may be considered passing. */
export function reportGate(report: GateReport): boolean

/** `reportGate`, then `process.exit`. */
export function reportGateAndExit(report: GateReport): never
