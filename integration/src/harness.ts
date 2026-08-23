/**
 * The harness every live suite goes through.
 *
 * It exists to make one thing impossible: a suite that appears to have run
 * against a real API when it did not. Vitest reports a skipped test and a
 * passing test with the same absence of red, so the reason for a skip has to be
 * stated where a human reading CI output will see it — naming the exact variable
 * that was missing, not a vague "not configured".
 */

import { describe } from 'vitest'

import { has, liveRunEnabled, missingFor, unsafeReason } from './credentials.js'
import type { ServiceSpec } from './services.js'

export interface LiveSuiteOptions {
  /**
   * Whether this suite writes or spends. Default `true`.
   *
   * A key proves who you are; a target says where it is safe to act. Suites
   * that only authenticate or only read need the first and not the second, and
   * gating them on both keeps them dark for no reason — a key alone is enough
   * to prove the provider still accepts our auth. Set `false` for read-only
   * suites and they light up as soon as the credential exists.
   */
  readonly sends?: boolean
  /**
   * Gate on these variable names instead of the whole spec.
   *
   * Some contracts are reachable with a subset of the credentials — GitHub
   * accepts or rejects an authorize URL knowing only the client id, and that is
   * a real server-side answer worth having before a client secret exists.
   * Without this, one missing variable keeps dark every assertion in the file,
   * including the ones that never needed it.
   */
  readonly requires?: readonly string[]
}

/**
 * The variables this suite may not run without.
 *
 * Two rails, answering different questions. `requires` narrows which CREDENTIALS a contract
 * needs — GitHub answers an authorize URL knowing only the client id, and gating that on a
 * client secret keeps a real answer dark for no reason. `sends` declares whether the suite
 * writes or spends, which is what makes the spec's `target` variables mandatory: a key proves
 * who you are, a target says where it is safe to act.
 *
 * They used to be one branch, so passing `requires` dropped `sends` with it. All three voice
 * suites narrow with `requires` and spend real money, so `VOICE_TEST_TTS_VOICE` was never
 * checked: the suite fell back to a default voice and billed OpenAI while the readiness report
 * in the same run printed that variable as missing (#82).
 *
 * @param isSet - Injected so the decision can be tested without an environment. Defaults to the
 * real reader.
 */
export function missingForSuite(
  spec: ServiceSpec,
  opts: LiveSuiteOptions,
  isSet: (name: string) => boolean = has,
): readonly string[] {
  const sends = opts.sends ?? true
  if (opts.requires === undefined) return missingFor(spec, { includeTarget: sends })

  const targets = sends ? spec.target.map((cred) => cred.name) : []
  return [...new Set([...opts.requires, ...targets])].filter((name) => !isSet(name))
}

/**
 * Declare a live suite for one service.
 *
 * Skips, loudly and with a reason, when the run is not opted into, the
 * credentials are absent, or the credential is one we refuse to use (a Stripe
 * live key). Never silently.
 */
export function describeLive(
  spec: ServiceSpec,
  name: string,
  body: () => void,
  opts: LiveSuiteOptions = {},
): void {
  if (!liveRunEnabled()) {
    describe.skip(`${spec.label} — ${name} [skipped: set E2E_LIVE=1 to talk to real APIs]`, body)
    return
  }
  const unsafe = unsafeReason(spec)
  if (unsafe !== undefined) {
    describe.skip(`${spec.label} — ${name} [skipped: ${unsafe}]`, body)
    return
  }
  const missing = missingForSuite(spec, opts)
  if (missing.length > 0) {
    describe.skip(`${spec.label} — ${name} [skipped: missing ${missing.join(', ')}]`, body)
    return
  }
  describe(`${spec.label} — ${name}`, body)
}

/**
 * Declare a suite that cannot pass in CI, because it needs a browser session.
 *
 * An OAuth round trip needs somebody to click "allow": the authorization code is
 * issued to a redirect, not to an API caller. That rules it out on a runner —
 * but NOT on a workstation with a logged-in browser, which is why the message
 * points at the script that does run it (`flow:github`) instead of implying the
 * path is untestable anywhere.
 *
 * The server half — how a real refusal is mapped — runs unattended and lives in
 * the normal {@link describeLive} suites.
 */
export function describeManualOAuth(spec: ServiceSpec, name: string, body: () => void): void {
  describe.skip(
    `${spec.label} — ${name} [skipped: needs a browser session, so it cannot run in CI — run it locally with the flow:* script for this service]`,
    body,
  )
}

/** Poll `check` until it returns a value, or give up. Used for delivery round trips. */
export async function waitFor<T>(
  check: () => T | undefined | Promise<T | undefined>,
  opts: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<T> {
  const interval = opts.intervalMs ?? 500
  const deadline = Date.now() + opts.timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined) return value
    } catch (err) {
      last = err
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  // `String(err)` on a thrown plain object yields `[object Object]`, which turns a timeout
  // report into a dead end. Read the message when there is one.
  const reason = last instanceof Error ? last.message : JSON.stringify(last)
  const suffix = last === undefined ? '' : ` — last error: ${reason}`
  throw new Error(`timed out after ${opts.timeoutMs}ms waiting for ${opts.label}${suffix}`)
}
