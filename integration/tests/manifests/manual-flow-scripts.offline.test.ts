/**
 * A suite that tells you to run a script must name a script that exists.
 *
 * `describeManualOAuth` skips with "run it locally with the flow:* script for this service".
 * Measured 2026-08-24: for `auth-google` there was no such script, so the instruction pointed at
 * nothing and that provider's OAuth success path was exercised by neither CI nor a documented
 * procedure. It was found by reading. Nothing would have found it otherwise, because a skipped
 * suite is green and its message is prose.
 *
 * The link is DECLARED on the service rather than derived from its id, because the two do not
 * match: `auth-github` is served by `flow:github`. A convention nobody wrote down is a convention
 * that drifts, and a check that guessed `flow:<id>` would have failed both existing services while
 * they were correct.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SERVICES } from '../../src/services.js'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const TESTS_DIR = join(REPO_ROOT, 'integration', 'tests')

/**
 * Service ids whose suite calls `describeManualOAuth`, found by reading the suites.
 *
 * The directory under `tests/` is the service id. That mapping is a convention, and it is the
 * check's one soft spot: a suite placed elsewhere is invisible here. It is asserted below rather
 * than assumed — every directory found must be a known service id, so a rename surfaces as a
 * failure instead of as silence.
 */
function servicesUsingManualOAuth(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(TESTS_DIR)) {
    const dir = join(TESTS_DIR, entry)
    if (!statSync(dir).isDirectory()) continue
    const usesIt = readdirSync(dir).some((file) => {
      if (!file.endsWith('.ts')) return false
      const text = readFileSync(join(dir, file), 'utf8')
      // BOTH the import and the call. A file mentioning the name in a string — this one does, twice
      // — is not a caller, and the first draft matched itself and reported `manifests` as a service
      // whose id had drifted. Requiring the import is what a real caller has and a mention does not.
      return /from '.*harness\.js'/.test(text) && /\bdescribeManualOAuth\(/.test(text)
    })
    if (usesIt) out.push(entry)
  }
  return out.sort()
}

function scripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'integration', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  return pkg.scripts
}

describe('a manual-OAuth suite points at a script that exists', () => {
  it('finds suites at all, so the assertions below cannot pass vacuously', () => {
    expect(servicesUsingManualOAuth().length).toBeGreaterThan(0)
  })

  it('every directory holding such a suite is a known service', () => {
    const known = new Set(SERVICES.map((s) => s.id))
    const unknown = servicesUsingManualOAuth().filter((id) => !known.has(id))

    expect(unknown, 'a suite directory that names no service — the id mapping has drifted').toEqual(
      [],
    )
  })

  it('every service with such a suite declares the script to run', () => {
    const byId = new Map(SERVICES.map((s) => [s.id, s]))
    const undeclared = servicesUsingManualOAuth().filter(
      (id) => byId.get(id)?.manualFlowScript === undefined,
    )

    expect(
      undeclared,
      'these suites tell a reader to run "the flow:* script for this service" and the service names none',
    ).toEqual([])
  })

  it('every declared script exists in integration/package.json', () => {
    const available = scripts()
    const missing = SERVICES.filter(
      (s) => s.manualFlowScript !== undefined && available[s.manualFlowScript] === undefined,
    ).map((s) => `${s.id} declares "${s.manualFlowScript}", which is not a script`)

    // The message names the service AND the script it expected — the item's third requirement.
    // A failure saying only "a script is missing" sends the reader to guess which of seven.
    expect(missing).toEqual([])
  })
})
