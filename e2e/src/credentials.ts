/**
 * Credential resolution for the live suites.
 *
 * Two sources, one shape:
 *
 * - Locally, `e2e/.env` — untracked; the root `.gitignore` already covers
 *   `.env` and `.env.*` while allowing `.env.example`.
 * - In CI, repository secrets mapped into `env:` on the job. Same variable
 *   names, so a suite never knows or cares which one it got.
 *
 * There is deliberately no fallback, no default and no "example" value. A test
 * that quietly runs against a placeholder proves nothing and takes a green tick
 * with it — which is the failure this whole package exists to avoid. When a
 * credential is missing the suite SKIPS, naming the variable and where to get
 * it.
 *
 * Values are never logged. Only variable NAMES ever reach test output, and
 * `readiness.test.ts` asserts that.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ServiceSpec } from './services.js'

let loaded: Record<string, string> | undefined

/** Strip one layer of matching quotes, if present. */
function unquote(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  return quoted ? value.slice(1, -1) : value
}

/** `KEY=value`, or undefined for a blank line, a comment, or a line with no key. */
function parseEnvLine(rawLine: string): readonly [string, string] | undefined {
  const line = rawLine.trim()
  if (line.length === 0 || line.startsWith('#')) return undefined
  const eq = line.indexOf('=')
  if (eq <= 0) return undefined
  return [line.slice(0, eq).trim(), unquote(line.slice(eq + 1).trim())]
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const entry = parseEnvLine(rawLine)
    if (entry !== undefined) out[entry[0]] = entry[1]
  }
  return out
}

function env(): Record<string, string> {
  if (loaded !== undefined) return loaded
  let fromFile: Record<string, string> = {}
  try {
    fromFile = parseEnvFile(readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8'))
  } catch {
    // No local .env is the normal case in CI.
  }
  const merged: Record<string, string> = { ...fromFile }
  // process.env wins, so a CI secret is never shadowed by a stray local file.
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v.length > 0) merged[k] = v
  }
  loaded = merged
  return merged
}

/** A variable is "set" only if it is present AND non-empty. */
export function has(name: string): boolean {
  const v = env()[name]
  return v !== undefined && v.trim().length > 0
}

/**
 * Read a required variable. Throws rather than returning a placeholder — by the
 * time a suite calls this, {@link missingFor} has already decided it should run.
 */
export function required(name: string): string {
  const v = env()[name]
  if (v === undefined || v.trim().length === 0) {
    throw new Error(`missing credential ${name} — this suite should have been skipped`)
  }
  return v.trim()
}

export function optional(name: string): string | undefined {
  const v = env()[name]
  return v === undefined || v.trim().length === 0 ? undefined : v.trim()
}

/**
 * Names of the variables this service needs and does not have.
 *
 * `includeTarget` exists because the two kinds answer different questions. A
 * credential says who we are; a target says where it is safe to act. A suite
 * that only authenticates needs the first and not the second, and demanding
 * both would keep it dark while the thing it tests is perfectly reachable.
 */
export function missingFor(spec: ServiceSpec, opts: { includeTarget?: boolean } = {}): string[] {
  const vars =
    opts.includeTarget === false ? spec.credentials : [...spec.credentials, ...spec.target]
  return vars.map((c) => c.name).filter((n) => !has(n))
}

/**
 * Stripe in live mode would move real money, so a key that is not a test key is
 * treated as not configured at all rather than as something to be careful with.
 * Returns the reason it is unsafe, or undefined when it is fine.
 */
export function unsafeReason(spec: ServiceSpec): string | undefined {
  if (spec.id !== 'payments') return undefined
  const key = optional('STRIPE_SECRET_KEY')
  if (key === undefined) return undefined
  return key.startsWith('sk_test_')
    ? undefined
    : 'STRIPE_SECRET_KEY is not a test key (expected sk_test_…) — refusing to touch live money'
}

/** Live suites are opt-in: they call real APIs and cost real money. */
export function liveRunEnabled(): boolean {
  return has('E2E_LIVE') && required('E2E_LIVE') !== '0'
}

/**
 * A short marker put into everything these tests create, so anything that
 * escapes into a real inbox or dashboard is identifiable as test traffic at a
 * glance, and so a test can recognise its own artifact when it comes back.
 */
export function runMarker(): string {
  return `theokit-e2e-${process.env.GITHUB_RUN_ID ?? 'local'}-${Math.random().toString(36).slice(2, 8)}`
}
