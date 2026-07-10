import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetBridge } from '../src/internal/budget-bridge.js'
import { CopilotError } from '../src/types.js'

describe('BudgetBridge', () => {
  it('no-op when config absent', () => {
    const b = new BudgetBridge(undefined)
    expect(() => b.preflightCheck('c1', 'r1', 0.5)).not.toThrow()
    b.charge('c1', 'r1', 0.5)
    expect(b.getUsage('c1', 'r1')).toEqual({ dailyUsedUsd: 0, monthlyUsedUsd: 0 })
  })

  it('preflight rejects perRequestUsd over-limit', () => {
    const b = new BudgetBridge({ perRoom: { perRequestUsd: 0.005 } })
    expect(() => b.preflightCheck('c1', 'r1', 0.01)).toThrow(CopilotError)
  })

  it('preflight rejects dailyUsd over-limit', () => {
    const b = new BudgetBridge({ perRoom: { dailyUsd: 0.5 } })
    b.charge('c1', 'r1', 0.45)
    expect(() => b.preflightCheck('c1', 'r1', 0.1)).toThrow(/dailyUsd 0.5 exceeded/)
  })

  it('preflight rejects monthlyUsd over-limit', () => {
    const b = new BudgetBridge({ perRoom: { monthlyUsd: 5 } })
    b.charge('c1', 'r1', 4.9)
    expect(() => b.preflightCheck('c1', 'r1', 0.2)).toThrow(/monthlyUsd 5 exceeded/)
  })

  it('charge accumulates usage', () => {
    const b = new BudgetBridge({ perRoom: { dailyUsd: 10 } })
    b.charge('c1', 'r1', 0.5)
    b.charge('c1', 'r1', 0.7)
    expect(b.getUsage('c1', 'r1').dailyUsedUsd).toBeCloseTo(1.2, 4)
  })

  it('isolates per copilot + per room', () => {
    const b = new BudgetBridge({ perRoom: { dailyUsd: 1 } })
    b.charge('c1', 'r1', 0.5)
    b.charge('c2', 'r1', 0.3)
    b.charge('c1', 'r2', 0.2)
    expect(b.getUsage('c1', 'r1').dailyUsedUsd).toBeCloseTo(0.5, 4)
    expect(b.getUsage('c2', 'r1').dailyUsedUsd).toBeCloseTo(0.3, 4)
    expect(b.getUsage('c1', 'r2').dailyUsedUsd).toBeCloseTo(0.2, 4)
  })

  it('preflight passes when no per-room config', () => {
    const b = new BudgetBridge({})
    expect(() => b.preflightCheck('c1', 'r1', 100)).not.toThrow()
  })
})

describe('BudgetBridge — calendar month boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resets monthly budget on Feb→Mar boundary (28 days, not 30)', () => {
    // Feb 1 2026 00:00:00 UTC
    const feb1 = Date.UTC(2026, 1, 1, 0, 0, 0, 0)
    vi.spyOn(Date, 'now').mockReturnValue(feb1)

    const b = new BudgetBridge({ perRoom: { monthlyUsd: 10 } })
    b.charge('c1', 'r1', 8)
    expect(b.getUsage('c1', 'r1').monthlyUsedUsd).toBeCloseTo(8, 4)

    // Mar 1 2026 00:00:00 UTC — exactly 28 days later (non-leap year)
    const mar1 = Date.UTC(2026, 2, 1, 0, 0, 0, 0)
    vi.spyOn(Date, 'now').mockReturnValue(mar1)

    // getUsage triggers getOrInitState which resets if month rolled over
    expect(b.getUsage('c1', 'r1').monthlyUsedUsd).toBe(0)
  })

  it('does NOT reset monthly budget mid-month', () => {
    // Jan 1 2026 00:00:00 UTC
    const jan1 = Date.UTC(2026, 0, 1, 0, 0, 0, 0)
    vi.spyOn(Date, 'now').mockReturnValue(jan1)

    const b = new BudgetBridge({ perRoom: { monthlyUsd: 10 } })
    b.charge('c1', 'r1', 5)

    // Jan 20 — still same month, usage should persist
    const jan20 = Date.UTC(2026, 0, 20, 12, 0, 0, 0)
    vi.spyOn(Date, 'now').mockReturnValue(jan20)

    expect(b.getUsage('c1', 'r1').monthlyUsedUsd).toBeCloseTo(5, 4)
  })

  it('resets monthly budget on Dec→Jan rollover (year boundary)', () => {
    // Dec 1 2025 00:00:00 UTC
    const dec1 = Date.UTC(2025, 11, 1, 0, 0, 0, 0)
    vi.spyOn(Date, 'now').mockReturnValue(dec1)

    const b = new BudgetBridge({ perRoom: { monthlyUsd: 20 } })
    b.charge('c1', 'r1', 15)
    expect(b.getUsage('c1', 'r1').monthlyUsedUsd).toBeCloseTo(15, 4)

    // Jan 1 2026 00:00:00 UTC — new year
    const jan1 = Date.UTC(2026, 0, 1, 0, 0, 0, 0)
    vi.spyOn(Date, 'now').mockReturnValue(jan1)

    expect(b.getUsage('c1', 'r1').monthlyUsedUsd).toBe(0)
  })

  it('resets on 31-day month boundary (Jan→Feb)', () => {
    // Jan 1 2026 00:00:00 UTC
    const jan1 = Date.UTC(2026, 0, 1, 0, 0, 0, 0)
    vi.spyOn(Date, 'now').mockReturnValue(jan1)

    const b = new BudgetBridge({ perRoom: { monthlyUsd: 10 } })
    b.charge('c1', 'r1', 7)

    // Jan 31 — still January, should NOT reset
    const jan31 = Date.UTC(2026, 0, 31, 23, 59, 59, 0)
    vi.spyOn(Date, 'now').mockReturnValue(jan31)
    expect(b.getUsage('c1', 'r1').monthlyUsedUsd).toBeCloseTo(7, 4)

    // Feb 1 — new month, should reset
    const feb1 = Date.UTC(2026, 1, 1, 0, 0, 0, 0)
    vi.spyOn(Date, 'now').mockReturnValue(feb1)
    expect(b.getUsage('c1', 'r1').monthlyUsedUsd).toBe(0)
  })

  describe('reservation model (#219 / #223 / EC-2)', () => {
    it('test_reserve_holds_budget_so_second_concurrent_reserve_is_rejected', () => {
      const b = new BudgetBridge({ perRoom: { dailyUsd: 0.5 } })
      const r1 = b.reserve('c1', 'r1', 0.5) // atomic check + hold
      expect(r1).toBeDefined()
      // The hold is visible immediately — a concurrent second invocation that
      // ran preflight before the first charged would now be rejected (no TOCTOU).
      expect(b.getUsage('c1', 'r1').dailyUsedUsd).toBeCloseTo(0.5, 4)
      expect(() => b.reserve('c1', 'r1', 0.5)).toThrow(/dailyUsd 0.5 exceeded/)
    })

    it('test_reserve_rechecks_per_request_limit', () => {
      const b = new BudgetBridge({ perRoom: { perRequestUsd: 0.001 } })
      expect(() => b.reserve('c1', 'r1', 0.01)).toThrow(CopilotError)
      expect(() => b.reserve('c1', 'r1', 0.01)).toThrow(/perRequestUsd/)
    })

    it('test_release_restores_held_budget', () => {
      const b = new BudgetBridge({ perRoom: { dailyUsd: 0.5 } })
      const r = b.reserve('c1', 'r1', 0.5)
      b.release(r)
      expect(b.getUsage('c1', 'r1').dailyUsedUsd).toBe(0)
      // Budget is freed → a later invocation is admitted.
      expect(() => b.reserve('c1', 'r1', 0.5)).not.toThrow()
    })

    it('test_reconcile_settles_to_actual_and_is_idempotent', () => {
      const b = new BudgetBridge({ perRoom: { dailyUsd: 1 } })
      const r = b.reserve('c1', 'r1', 0.5) // holds 0.5
      b.reconcile(r, 0.2) // actual was 0.2
      expect(b.getUsage('c1', 'r1').dailyUsedUsd).toBeCloseTo(0.2, 4)
      // Double-settle is a no-op (settled flag).
      b.reconcile(r, 0.9)
      b.release(r)
      expect(b.getUsage('c1', 'r1').dailyUsedUsd).toBeCloseTo(0.2, 4)
    })

    it('test_reconcile_clamps_nonnegative', () => {
      const b = new BudgetBridge({ perRoom: { dailyUsd: 1 } })
      const r = b.reserve('c1', 'r1', 0.5)
      b.reconcile(r, 0) // actual 0 → delta -0.5 must not drive usage negative
      expect(b.getUsage('c1', 'r1').dailyUsedUsd).toBe(0)
    })
  })
})
