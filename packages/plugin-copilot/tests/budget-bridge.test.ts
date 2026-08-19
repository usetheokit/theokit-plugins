/**
 * The reservation layer, against the real SDK Budget (#62).
 *
 * The previous version of this file tested a spend tracker this package no longer owns:
 * daily and monthly counters, UTC window arithmetic, Feb→Mar and Dec→Jan resets. Those
 * belong to `@theokit/sdk` now, and re-testing them here would be asserting someone
 * else's calendar — with the added dishonesty that our `monthlyUsd` maps to the SDK's
 * ROLLING `30d` window, so the old calendar-month assertions would have been testing a
 * behaviour we deliberately no longer have.
 *
 * What is tested here is what this layer actually adds, and nothing else:
 *
 *   the per-request cap        no SDK equivalent — its limits are windows
 *   in-flight holds            the SDK is check-then-charge; between the two, a
 *                              concurrent invocation sees nothing
 *   settle-once semantics      reconcile charges, release does not, both idempotent
 *   name derivation            two rooms must never share a ceiling
 *
 * Every case runs against a real `Budget` from the SDK. There is no fake budget: a fake
 * would agree with whoever wrote it, which is how #61 shipped.
 */

import { Budget } from '@theokit/sdk'
import { beforeEach, describe, expect, it } from 'vitest'

import { BudgetBridge, budgetNameFor } from '../src/internal/budget-bridge.js'
import { CopilotError } from '../src/types.js'

/** Unique per test so the SDK's process-wide registry cannot leak state between them. */
let seq = 0
function room(): { copilot: string; room: string } {
  seq += 1
  return { copilot: `c${seq}`, room: `r${seq}` }
}

beforeEach(() => {
  for (const handle of Budget.list()) Budget.delete(handle.name)
})

describe('no budget configured', () => {
  it('reserves, reconciles and reports zero without touching the SDK registry', async () => {
    const bridge = new BudgetBridge(undefined)
    const { copilot, room: r } = room()

    const reservation = bridge.reserve(copilot, r, 5)
    await bridge.reconcile(reservation, 5)

    expect(bridge.getUsage(copilot, r)).toEqual({
      dailyUsedUsd: 0,
      monthlyUsedUsd: 0,
      inFlightUsd: 0,
    })
    // An unconfigured copilot must not register a budget: `Budget.list()` is an ops
    // surface, and filling it with empty entries makes it useless.
    expect(Budget.get(budgetNameFor(copilot, r))).toBeUndefined()
  })
})

describe('the per-request cap, which the SDK has no window for', () => {
  it('refuses an estimate above it, with its own error code', () => {
    const bridge = new BudgetBridge({ perRoom: { perRequestUsd: 0.5, dailyUsd: 100 } })
    const { copilot, room: r } = room()

    expect(() => bridge.reserve(copilot, r, 0.75)).toThrow(CopilotError)
    try {
      bridge.reserve(copilot, r, 0.75)
    } catch (err) {
      // The code matters more than the message: a caller branches on it, and the
      // per-request breach is the one a developer can fix by asking for less.
      expect((err as CopilotError & { code?: string }).code).toBe('budget_per_request_exceeded')
    }
  })

  it('a refused reserve holds nothing — there is no token to settle', () => {
    const bridge = new BudgetBridge({ perRoom: { perRequestUsd: 0.5, dailyUsd: 100 } })
    const { copilot, room: r } = room()

    expect(() => bridge.reserve(copilot, r, 0.75)).toThrow()
    expect(bridge.getUsage(copilot, r).inFlightUsd).toBe(0)
  })
})

describe('in-flight holds — the gap between the SDK check and the SDK charge', () => {
  it('a second concurrent reserve is refused while the first is unsettled', () => {
    const bridge = new BudgetBridge({ perRoom: { dailyUsd: 1 } })
    const { copilot, room: r } = room()

    bridge.reserve(copilot, r, 0.8) // held, not yet charged
    // The SDK would allow this: nothing has been charged, so `remainingIn('1d')` is
    // still the full limit. This is exactly the race a self-triggering copilot hits.
    expect(() => bridge.reserve(copilot, r, 0.8)).toThrow(/in flight/i)
  })

  it('the hold is visible in getUsage, and separate from committed spend', () => {
    const bridge = new BudgetBridge({ perRoom: { dailyUsd: 10 } })
    const { copilot, room: r } = room()

    bridge.reserve(copilot, r, 3)
    const usage = bridge.getUsage(copilot, r)

    // Reported apart on purpose: an operator needs to tell money spent from money
    // promised, and folding them into one number hides which is which.
    expect(usage.inFlightUsd).toBe(3)
    expect(usage.dailyUsedUsd).toBe(0)
  })

  it('releasing gives the hold back so the next call fits', () => {
    const bridge = new BudgetBridge({ perRoom: { dailyUsd: 1 } })
    const { copilot, room: r } = room()

    const first = bridge.reserve(copilot, r, 0.8)
    bridge.release(first)

    // EC-2: a failed invocation must not leak budget.
    expect(bridge.getUsage(copilot, r).inFlightUsd).toBe(0)
    expect(() => bridge.reserve(copilot, r, 0.8)).not.toThrow()
  })
})

describe('settling', () => {
  it('reconcile charges the SDK budget with the actual, not the estimate', async () => {
    const bridge = new BudgetBridge({ perRoom: { dailyUsd: 10 } })
    const { copilot, room: r } = room()

    const reservation = bridge.reserve(copilot, r, 5) // estimate
    await bridge.reconcile(reservation, 0.25) // what it really cost

    const usage = bridge.getUsage(copilot, r)
    expect(usage.dailyUsedUsd).toBeCloseTo(0.25, 6)
    expect(usage.inFlightUsd, 'the hold outlived the settlement').toBe(0)
  })

  it('release charges nothing at all', async () => {
    const bridge = new BudgetBridge({ perRoom: { dailyUsd: 10 } })
    const { copilot, room: r } = room()

    bridge.release(bridge.reserve(copilot, r, 5))
    await Promise.resolve()

    expect(bridge.getUsage(copilot, r).dailyUsedUsd).toBe(0)
  })

  it('both are idempotent — a double settle cannot double-charge', async () => {
    const bridge = new BudgetBridge({ perRoom: { dailyUsd: 10 } })
    const { copilot, room: r } = room()

    const reservation = bridge.reserve(copilot, r, 1)
    await bridge.reconcile(reservation, 2)
    await bridge.reconcile(reservation, 2)
    bridge.release(reservation)

    expect(bridge.getUsage(copilot, r).dailyUsedUsd).toBeCloseTo(2, 6)
  })

  it('a negative actual is clamped rather than credited', async () => {
    const bridge = new BudgetBridge({ perRoom: { dailyUsd: 10 } })
    const { copilot, room: r } = room()

    await bridge.reconcile(bridge.reserve(copilot, r, 1), -5)

    // Refunding a budget from a bad cost computation would raise the ceiling for the
    // rest of the window — the failure mode is silent over-spend, so clamp.
    expect(bridge.getUsage(copilot, r).dailyUsedUsd).toBe(0)
  })
})

describe('the SDK enforces the windows, and does it for us', () => {
  it('committed spend over the daily limit blocks the next reserve', async () => {
    const bridge = new BudgetBridge({ perRoom: { dailyUsd: 1 } })
    const { copilot, room: r } = room()

    await bridge.reconcile(bridge.reserve(copilot, r, 0.9), 0.9)

    // The refusal comes from the SDK's own enforcement in `block` mode — this layer
    // does not re-derive it.
    expect(() => bridge.reserve(copilot, r, 0.5)).toThrow()
  })

  it('an explicit SDK window overrides the sugar for the same window', () => {
    const bridge = new BudgetBridge({
      perRoom: { dailyUsd: 100, limits: [{ window: '1d', limitUsd: 1 }] },
    })
    const { copilot, room: r } = room()

    // Both express `1d`; the explicit one is what the caller wrote, so it wins rather
    // than the stricter of the two silently applying.
    expect(() => bridge.reserve(copilot, r, 2)).toThrow()
  })

  it('a window the sugar cannot express is honoured', () => {
    const bridge = new BudgetBridge({ perRoom: { limits: [{ window: '1h', limitUsd: 0.1 }] } })
    const { copilot, room: r } = room()

    expect(() => bridge.reserve(copilot, r, 0.5)).toThrow()
  })
})

describe('budget names', () => {
  it('are isolated per copilot and per room', () => {
    expect(budgetNameFor('a', 'r1')).not.toBe(budgetNameFor('a', 'r2'))
    expect(budgetNameFor('a', 'r1')).not.toBe(budgetNameFor('b', 'r1'))
  })

  it('do not collide when different keys sanitise to the same string', () => {
    // The bug a naive `replace(/[^a-z0-9_-]/g, '-')` introduces: two rooms sharing one
    // ceiling, each seeing half the budget it was configured with, with nothing to
    // indicate why.
    expect(budgetNameFor('a', 'x/y')).not.toBe(budgetNameFor('a', 'x-y'))
    expect(budgetNameFor('a', 'x y')).not.toBe(budgetNameFor('a', 'x_y'))
  })

  it('satisfy the SDK name grammar even for hostile input', () => {
    const grammar = /^[a-z0-9][a-z0-9_-]*$/
    for (const roomId of ['ROOM ONE', '///', 'ünïcödé', '', '.'.repeat(100)]) {
      expect(budgetNameFor('c', roomId), `rejected for ${JSON.stringify(roomId)}`).toMatch(grammar)
    }
  })

  it('are stable — the same pair always yields the same budget', () => {
    expect(budgetNameFor('helper', 'canvas')).toBe(budgetNameFor('helper', 'canvas'))
  })
})
