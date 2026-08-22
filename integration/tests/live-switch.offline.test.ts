/**
 * The master switch, and what it accepts.
 *
 * `liveRunEnabled()` decides whether a run may call real providers — send email, create Stripe
 * and AbacatePay checkouts, spend OpenAI credit. It was `has('E2E_LIVE') && required('E2E_LIVE')
 * !== '0'`, so every non-empty value except the literal `'0'` opted IN. A developer switching
 * `E2E_LIVE=0` to `E2E_LIVE=false` to turn live runs off turned them on, and the generated
 * `.env.example` states the opposite in its header: "Nothing runs without E2E_LIVE=1" (#79).
 *
 * The predicate is injected so these cases do not depend on the environment of the machine
 * running them — this repository has an `integration/.env`, and a test whose result changes with
 * it would be exactly the kind of accident the suite is about.
 */

import { describe, expect, it } from 'vitest'

import { isLiveRunEnabled } from '../src/credentials.js'

/** Stand in for the environment: the switch is set to `value`, or absent when undefined. */
const switchSetTo = (value: string | undefined) => (): string | undefined => value

describe('isLiveRunEnabled', () => {
  it('opts in on the documented value', () => {
    expect(isLiveRunEnabled(switchSetTo('1'))).toBe(true)
  })

  it('stays off when the switch is absent', () => {
    expect(isLiveRunEnabled(switchSetTo(undefined))).toBe(false)
  })

  it('stays off on 0', () => {
    expect(isLiveRunEnabled(switchSetTo('0'))).toBe(false)
  })

  it.each(['false', 'no', 'off', 'FALSE', 'disabled', ''])(
    'stays off on %j, which used to opt in',
    (value) => {
      // The defect: `!== '0'` made every one of these mean "spend money".
      expect(isLiveRunEnabled(switchSetTo(value))).toBe(false)
    },
  )

  it.each(['true', 'yes', 'on', '2', 'YES'])(
    'stays off on %j — an unrecognised value never opts in',
    (value) => {
      // Deliberately NOT treated as truthy. A switch that guesses is how an unattended run
      // starts spending on a value nobody meant as consent.
      expect(isLiveRunEnabled(switchSetTo(value))).toBe(false)
    },
  )
})
