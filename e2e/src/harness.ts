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

import { liveRunEnabled, missingFor, unsafeReason } from './credentials.js'
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
  const missing = missingFor(spec, { includeTarget: opts.sends ?? true })
  if (missing.length > 0) {
    describe.skip(`${spec.label} — ${name} [skipped: missing ${missing.join(', ')}]`, body)
    return
  }
  describe(`${spec.label} — ${name}`, body)
}

/**
 * Declare a suite that can only pass with a human in a browser.
 *
 * An OAuth round trip needs somebody to click "allow": the authorization code
 * is issued to a redirect, not to an API caller. Saying that out loud beats a
 * suite that mints its own code and proves only that its fixture works.
 *
 * The server half — the authorize URL we build, and how a real refusal is
 * mapped — runs unattended and lives in the normal {@link describeLive} suites.
 */
export function describeManualOAuth(spec: ServiceSpec, name: string, body: () => void): void {
  describe.skip(
    `${spec.label} — ${name} [skipped: needs a browser and a human consent click; the server half is covered by the suites above]`,
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
  const suffix = last === undefined ? '' : ` — last error: ${String(last)}`
  throw new Error(`timed out after ${opts.timeoutMs}ms waiting for ${opts.label}${suffix}`)
}
