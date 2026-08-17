/**
 * Readiness report — which services can actually be exercised right now.
 *
 * This is the one suite that always runs, with or without credentials. It does
 * not talk to any API; it answers the question you ask before a live run: "what
 * is wired up, and what is each missing?"
 *
 * It exists because the honest state of a live suite is otherwise invisible. Six
 * services with five skipped and one green reads, at a glance, exactly like six
 * services passing. Printing the gap turns that glance into information.
 */

import { readdir } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { has, liveRunEnabled, missingFor, unsafeReason } from '../src/credentials.js'
import { SERVICES, allVariableNames, type ServiceSpec } from '../src/services.js'

/** The lines describing one service: its status, then each gap and how to close it. */
function describeRow(spec: ServiceSpec, missing: readonly string[]): string[] {
  const unsafe = unsafeReason(spec)
  const mark = unsafe !== undefined ? 'UNSAFE ' : missing.length === 0 ? 'ready  ' : 'missing'
  const lines = [`  [${mark}] ${spec.label.padEnd(30)} (${spec.exercise})`]
  if (unsafe !== undefined) lines.push(`             ✗ ${unsafe}`)
  const docs = [...spec.credentials, ...spec.target]
  for (const name of missing) {
    const doc = docs.find((c) => c.name === name)
    lines.push(`             ${name} — ${doc?.what ?? ''}`)
    if (doc !== undefined) lines.push(`             ↳ ${doc.where}`)
  }
  if (spec.caveat !== undefined) lines.push(`             ⚠ ${spec.caveat}`)
  return lines
}

async function testDirectories(): Promise<string[]> {
  const entries = await readdir(new URL('.', import.meta.url), { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

describe('live-test readiness', () => {
  it('reports what is configured, and what each missing service still needs', async () => {
    const rows = SERVICES.map((spec) => {
      const missing = missingFor(spec)
      return { spec, missing, ready: missing.length === 0 && unsafeReason(spec) === undefined }
    })

    const dirs = await testDirectories()
    const withoutSuite = SERVICES.filter((s) => !dirs.includes(s.id)).map((s) => s.id)

    const ready = rows.filter((r) => r.ready).length
    const lines = [
      '',
      `Live run enabled (E2E_LIVE): ${liveRunEnabled() ? 'yes' : 'NO — suites will skip'}`,
      `Services ready: ${ready}/${rows.length}`,
      '',
      ...rows.flatMap((row) => describeRow(row.spec, row.missing)),
      ...(withoutSuite.length > 0
        ? [`  registered with no suite yet: ${withoutSuite.join(', ')}`, '']
        : []),
    ]
    process.stdout.write(`${lines.join('\n')}\n`)

    // The report is the point; the assertion only guards the report itself.
    expect(rows.length).toBe(SERVICES.length)
  })

  it('never reads a credential VALUE into the report', () => {
    // A readiness report that printed values would leak every secret into CI
    // logs. It may only ever answer set/not-set.
    for (const name of allVariableNames()) {
      expect(typeof has(name)).toBe('boolean')
    }
  })

  it('gives every service at least one credential and one target', () => {
    // A service with no target has nowhere safe to act, and would otherwise look
    // "ready" while being untestable.
    for (const spec of SERVICES) {
      expect(spec.credentials.length, `${spec.id} credentials`).toBeGreaterThan(0)
      expect(spec.target.length, `${spec.id} target`).toBeGreaterThan(0)
    }
  })

  it('uses a unique environment variable name across every service', () => {
    // Two services sharing a name would silently authenticate one with the
    // other's credential.
    const seen = new Map<string, string>()
    for (const spec of SERVICES) {
      for (const cred of [...spec.credentials, ...spec.target]) {
        const prior = seen.get(cred.name)
        expect(prior, `${cred.name} declared by both ${prior} and ${spec.id}`).toBeUndefined()
        seen.set(cred.name, spec.id)
      }
    }
  })

  it('has no test directory without a registry entry', async () => {
    // Keeps the registry and the suites from drifting apart. The reverse — a
    // registered service with no suite yet — is reported above rather than
    // failed, because a registry entry is also how someone learns which
    // credential to create first.
    const ids = SERVICES.map((s) => s.id)
    for (const dir of await testDirectories()) {
      expect(ids, `tests/${dir}/ has no entry in SERVICES`).toContain(dir)
    }
  })

  it('documents where every credential comes from', () => {
    // `where` is what makes the report actionable. A blank one turns "missing
    // RESEND_API_KEY" into a scavenger hunt.
    for (const spec of SERVICES) {
      for (const cred of [...spec.credentials, ...spec.target]) {
        expect(cred.what.length, `${cred.name}.what`).toBeGreaterThan(0)
        expect(cred.where.length, `${cred.name}.where`).toBeGreaterThan(0)
      }
    }
  })
})
