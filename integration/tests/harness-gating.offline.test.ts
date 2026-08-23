/**
 * Unit tests for which variables gate a live suite.
 *
 * `describeLive` used to compute this inline, and when a suite passed `requires` it skipped the
 * whole spec-derived path — dropping `sends` with it. `sends` is the rail that answers a
 * different question from `requires`: not "which credentials does this contract need" but "where
 * is it safe to act, and what may it spend on". All three voice suites gate with `requires`, so
 * their target variable was never checked and the suite billed OpenAI while the readiness report
 * in the same run printed it as missing (#82).
 *
 * The predicate is injected rather than read from the environment, so these cases do not depend
 * on whether the machine running them happens to have an `integration/.env`.
 */

import { describe, expect, it } from 'vitest'

import { missingForSuite } from '../src/harness.js'
import type { ServiceSpec } from '../src/services.js'

const SPEC: ServiceSpec = {
  id: 'probe',
  label: 'Probe',
  pkg: '@theokit/probe',
  provider: 'Probe Inc',
  exercise: 'api-key',
  credentials: [
    { name: 'PROBE_KEY', what: 'api key', where: 'console' },
    { name: 'PROBE_SECRET', what: 'secret', where: 'console' },
  ],
  target: [{ name: 'PROBE_TARGET', what: 'throwaway target', where: 'console' }],
}

/** Treat exactly the listed names as set. */
const only =
  (...set: string[]) =>
  (name: string) =>
    set.includes(name)

describe('missingForSuite', () => {
  it('still gates on the target when the suite narrows with requires', () => {
    // The defect: `requires` narrows credentials, and the target rail went with it.
    const missing = missingForSuite(SPEC, { requires: ['PROBE_KEY'] }, only('PROBE_KEY'))
    expect(missing).toEqual(['PROBE_TARGET'])
  })

  it('honours sends:false alongside requires, leaving the target ungated', () => {
    const missing = missingForSuite(
      SPEC,
      { requires: ['PROBE_KEY'], sends: false },
      only('PROBE_KEY'),
    )
    expect(missing).toEqual([])
  })

  it('reports a required variable that is not set', () => {
    const missing = missingForSuite(
      SPEC,
      { requires: ['PROBE_KEY'], sends: false },
      only('PROBE_TARGET'),
    )
    expect(missing).toEqual(['PROBE_KEY'])
  })

  it('is empty when every required name and the target are set', () => {
    const missing = missingForSuite(
      SPEC,
      { requires: ['PROBE_KEY'] },
      only('PROBE_KEY', 'PROBE_TARGET'),
    )
    expect(missing).toEqual([])
  })

  it('keeps narrowing: a spec credential outside requires is not gated on', () => {
    // The whole point of `requires` — PROBE_SECRET is unset and must not keep the suite dark.
    const missing = missingForSuite(
      SPEC,
      { requires: ['PROBE_KEY'] },
      only('PROBE_KEY', 'PROBE_TARGET'),
    )
    expect(missing).not.toContain('PROBE_SECRET')
  })

  it('gates on nothing when a suite declares requires:[] and sends:false', () => {
    // The shape of the real auth-google discovery suite: public document, no credential, no
    // spend. Gating it on the spec's target would keep a suite dark that needs nothing.
    const missing = missingForSuite(SPEC, { requires: [], sends: false }, only())
    expect(missing).toEqual([])
  })

  it('still gates a spending suite that declares requires:[]', () => {
    // `requires: []` narrows credentials to none; it says nothing about spending, so the target
    // rail stays on unless the call site declares sends:false.
    const missing = missingForSuite(SPEC, { requires: [] }, only())
    expect(missing).toEqual(['PROBE_TARGET'])
  })

  it('reports a name once when it is both required and the target', () => {
    const missing = missingForSuite(SPEC, { requires: ['PROBE_TARGET'] }, only())
    expect(missing).toEqual(['PROBE_TARGET'])
  })
})
