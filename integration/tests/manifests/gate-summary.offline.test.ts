/**
 * A gate may not report success for a run that checked nothing.
 *
 * B-026 recorded three instances of this and predicted a fourth. Measured 2026-08-24, the fourth
 * and fifth were already live and were found by RUNNING the gates, not by reading them:
 *
 *   - `check-orphan-docblocks.mjs`, with its file list forced empty, printed
 *     `PASS — no docblock is stranded above another docblock.` and exited 0.
 *   - `check-doc-coverage.mjs`, with no packages, printed `overall 0/0 = 0.0% (floor 100%)` and
 *     then `PASS — every published entry is at or above the 100% floor.` — two adjacent lines that
 *     contradict each other.
 *
 * The three earlier sites were each fixed locally and each carries a `Never unconditional` comment.
 * The knowledge was right and written three times in prose, and prose carried it to no fourth file.
 * So it lives in a helper now, and this file is what keeps every gate using it.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { reportGate } from '../../../tools/lib/gate-summary.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Captures what a call writes, so the assertion is about output rather than about a return value. */
function capture(fn: () => unknown): { out: string; failed: boolean } {
  const lines: string[] = []
  const log = console.log
  const error = console.error
  console.log = (...a: unknown[]) => void lines.push(a.join(' '))
  console.error = (...a: unknown[]) => void lines.push(a.join(' '))
  try {
    const failed = fn() === false
    return { out: lines.join('\n'), failed }
  } finally {
    console.log = log
    console.error = error
  }
}

describe('a success line is a function of what was checked', () => {
  it('refuses to report success when nothing was checked', () => {
    const { out, failed } = capture(() =>
      reportGate({ label: 'probe', subject: 'widgets', checked: 0 }),
    )

    expect(failed, 'a gate that checked nothing must not report a pass').toBe(true)
    expect(out).not.toMatch(/PASS/)
    // Naming the subject is what makes the line actionable: "did not run" alone sends a reader to
    // the wrong file.
    expect(out).toMatch(/widgets/)
    expect(out).toMatch(/did not run/i)
  })

  it('reports success when something was checked, and says how much', () => {
    const { out, failed } = capture(() =>
      reportGate({ label: 'probe', subject: 'widgets', checked: 7 }),
    )

    expect(failed).toBe(false)
    expect(out).toMatch(/PASS/)
    // The count in the line is what let a reader catch instances 1-3 by eye.
    expect(out).toMatch(/7/)
  })

  it('prints what was skipped, on a pass as well as on a failure', () => {
    // The DoD's first bullet: "report success" and "report what was skipped" are ONE decision.
    // Two independent console.log calls are what let instance #5 print 0.0% and PASS together.
    const passing = capture(() =>
      reportGate({ label: 'probe', subject: 'widgets', checked: 7, skipped: ['a: no manifest'] }),
    )
    expect(passing.out).toMatch(/a: no manifest/)

    const empty = capture(() =>
      reportGate({ label: 'probe', subject: 'widgets', checked: 0, skipped: ['a: no manifest'] }),
    )
    expect(empty.out).toMatch(/a: no manifest/)
  })

  it('treats a negative count as a defect in the caller, not as zero', () => {
    // Silently coercing would let an arithmetic bug in a gate read as "checked nothing", which is
    // a different and much quieter failure than "the caller is wrong".
    expect(() => reportGate({ label: 'probe', subject: 'widgets', checked: -1 })).toThrow(
      /checked/i,
    )
  })
})

describe('every gate routes its success line through the helper', () => {
  /** Gate scripts, read from disk — never a hand-kept list. */
  function gateFiles(): string[] {
    const out: string[] = []
    for (const dir of ['tools', 'scripts']) {
      for (const name of readdirSync(join(REPO_ROOT, dir))) {
        if (!name.endsWith('.mjs')) continue
        const path = join(REPO_ROOT, dir, name)
        const text = readFileSync(path, 'utf8')
        // A gate is a script that can fail the build. A renderer or a library is not.
        if (!/process\.exit\(\s*1\s*\)|process\.exitCode\s*=\s*1/.test(text)) continue
        out.push(path)
      }
    }
    return out.sort()
  }

  it('finds gates at all, so the assertions below cannot pass vacuously', () => {
    // Without this the suite reproduces, one level up, the exact defect it exists to prevent: an
    // empty set producing a green run.
    expect(gateFiles().length).toBeGreaterThan(2)
  })

  it('routes every gate through it — a hand-kept list is how the fourth was missed', () => {
    const unrouted = gateFiles().filter((path) => {
      const text = readFileSync(path, 'utf8')
      return !text.includes('gate-summary.mjs')
    })

    expect(
      unrouted.map((p) => p.replace(REPO_ROOT, '')),
      'these gates decide their own success line, which is what B-026 is about',
    ).toEqual([])
  })
})
