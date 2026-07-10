/**
 * @theokit/plugin-copilot — Budget bridge (P#11 internal).
 *
 * Per ADR D7 — SDK Budget per-room. Stateful in-process tracker that
 * pre-flights cost estimates + charges actual usage.
 *
 * Simplified in-memory implementation for v0.1 — production deployments
 * should wire SDK Budget (D375-D388) directly via custom dispatcher.
 *
 * @internal
 */

import type { CopilotBudgetConfig } from '../types.js'
import { CopilotError } from '../types.js'

interface BudgetState {
  dailyUsedUsd: number
  monthlyUsedUsd: number
  dayStartMs: number
  monthStartMs: number
}

/**
 * Token returned by {@link BudgetBridge.reserve} (#219 / EC-2). Holds the
 * estimated cost in the budget at preflight (atomic check + hold) and is later
 * settled exactly once via {@link BudgetBridge.reconcile} (success → adjust to
 * actual) or {@link BudgetBridge.release} (failure → give the hold back).
 *
 * @internal
 */
export interface BudgetReservation {
  readonly copilotId: string
  readonly roomId: string
  readonly estimatedUsd: number
  /** Window epochs captured at reserve, so settle can detect a window reset. */
  dayStartMs: number
  monthStartMs: number
  settled: boolean
}

/**
 * Per-copilot-per-room budget tracker.
 *
 * @internal
 */
export class BudgetBridge {
  private readonly states = new Map<string, BudgetState>()

  constructor(private readonly config: CopilotBudgetConfig | undefined) {}

  private getKey(copilotId: string, roomId: string): string {
    return `${copilotId}:${roomId}`
  }

  private getOrInitState(key: string): BudgetState {
    let s = this.states.get(key)
    const now = Date.now()
    if (s === undefined) {
      s = {
        dailyUsedUsd: 0,
        monthlyUsedUsd: 0,
        dayStartMs: this.startOfDay(now),
        monthStartMs: this.startOfMonth(now),
      }
      this.states.set(key, s)
    }
    // Reset windows if elapsed.
    if (now >= s.dayStartMs + 86_400_000) {
      s.dailyUsedUsd = 0
      s.dayStartMs = this.startOfDay(now)
    }
    if (now >= this.startOfNextMonth(s.monthStartMs)) {
      s.monthlyUsedUsd = 0
      s.monthStartMs = this.startOfMonth(now)
    }
    return s
  }

  /**
   * Pre-flight check — throws {@link CopilotError} if estimated cost would
   * exceed any limit. No state mutation.
   */
  preflightCheck(copilotId: string, roomId: string, estimatedUsd: number): void {
    if (this.config === undefined || this.config.perRoom === undefined) return
    const s = this.getOrInitState(this.getKey(copilotId, roomId))
    this.assertWithinLimits(s, estimatedUsd)
  }

  /**
   * Shared limit check (DRY across {@link preflightCheck} and {@link reserve}).
   * Throws {@link CopilotError} with a stable code if `estimatedUsd` would push
   * any limit over. No mutation.
   */
  private assertWithinLimits(s: BudgetState, estimatedUsd: number): void {
    const lim = this.config?.perRoom
    if (lim === undefined) return
    if (lim.perRequestUsd !== undefined && estimatedUsd > lim.perRequestUsd) {
      throw new CopilotError(
        `Budget perRequestUsd ${lim.perRequestUsd} exceeded by estimate ${estimatedUsd.toFixed(4)}`,
        { code: 'budget_per_request_exceeded' },
      )
    }
    if (lim.dailyUsd !== undefined && s.dailyUsedUsd + estimatedUsd > lim.dailyUsd) {
      throw new CopilotError(
        `Budget dailyUsd ${lim.dailyUsd} exceeded by estimate ${estimatedUsd.toFixed(4)} (used ${s.dailyUsedUsd.toFixed(4)})`,
        { code: 'budget_daily_exceeded' },
      )
    }
    if (lim.monthlyUsd !== undefined && s.monthlyUsedUsd + estimatedUsd > lim.monthlyUsd) {
      throw new CopilotError(
        `Budget monthlyUsd ${lim.monthlyUsd} exceeded by estimate ${estimatedUsd.toFixed(4)} (used ${s.monthlyUsedUsd.toFixed(4)})`,
        { code: 'budget_monthly_exceeded' },
      )
    }
  }

  /**
   * #219 / #223: atomically check limits AND hold `estimatedUsd` in one
   * synchronous critical section (single window read, no await between check and
   * mutate), so two concurrent invocations cannot both pass a stale preflight.
   * Returns a reservation that MUST be settled via {@link reconcile} (success)
   * or {@link release} (failure) — see EC-2.
   */
  reserve(copilotId: string, roomId: string, estimatedUsd: number): BudgetReservation {
    const reservation: BudgetReservation = {
      copilotId,
      roomId,
      estimatedUsd,
      dayStartMs: 0,
      monthStartMs: 0,
      settled: false,
    }
    if (this.config === undefined || this.config.perRoom === undefined) return reservation
    const s = this.getOrInitState(this.getKey(copilotId, roomId))
    this.assertWithinLimits(s, estimatedUsd) // throws → nothing held, no token to settle
    // Atomic hold — no await between the check above and these writes.
    s.dailyUsedUsd += estimatedUsd
    s.monthlyUsedUsd += estimatedUsd
    reservation.dayStartMs = s.dayStartMs
    reservation.monthStartMs = s.monthStartMs
    return reservation
  }

  /**
   * Settle a reservation with the actual cost on success (#174 wires the real
   * actual; until then the caller passes the estimate). Replaces the held
   * estimate with the actual. Idempotent (settled-once). Never drives a window
   * negative; if the window reset since reserve, the held estimate is gone so
   * only the actual is counted.
   */
  reconcile(reservation: BudgetReservation, actualUsd: number): void {
    if (reservation.settled) return
    reservation.settled = true
    if (this.config === undefined || this.config.perRoom === undefined) return
    const s = this.getOrInitState(this.getKey(reservation.copilotId, reservation.roomId))
    const dailyDelta =
      s.dayStartMs === reservation.dayStartMs ? actualUsd - reservation.estimatedUsd : actualUsd
    const monthlyDelta =
      s.monthStartMs === reservation.monthStartMs ? actualUsd - reservation.estimatedUsd : actualUsd
    s.dailyUsedUsd = Math.max(0, s.dailyUsedUsd + dailyDelta)
    s.monthlyUsedUsd = Math.max(0, s.monthlyUsedUsd + monthlyDelta)
  }

  /**
   * Release a reservation on failure/cancellation (EC-2) — gives the held
   * estimate back so a failed invocation does not leak budget. Idempotent.
   */
  release(reservation: BudgetReservation): void {
    if (reservation.settled) return
    reservation.settled = true
    if (this.config === undefined || this.config.perRoom === undefined) return
    const s = this.getOrInitState(this.getKey(reservation.copilotId, reservation.roomId))
    // Only give back the hold if the window it was made in is still current.
    if (s.dayStartMs === reservation.dayStartMs) {
      s.dailyUsedUsd = Math.max(0, s.dailyUsedUsd - reservation.estimatedUsd)
    }
    if (s.monthStartMs === reservation.monthStartMs) {
      s.monthlyUsedUsd = Math.max(0, s.monthlyUsedUsd - reservation.estimatedUsd)
    }
  }

  /**
   * Charge actual cost after agent invocation completes.
   */
  charge(copilotId: string, roomId: string, actualUsd: number): void {
    if (this.config === undefined || this.config.perRoom === undefined) return
    const s = this.getOrInitState(this.getKey(copilotId, roomId))
    s.dailyUsedUsd += actualUsd
    s.monthlyUsedUsd += actualUsd
  }

  /** Read current usage (for ops visibility / theo-ui usage-meter). */
  getUsage(copilotId: string, roomId: string): { dailyUsedUsd: number; monthlyUsedUsd: number } {
    const s = this.getOrInitState(this.getKey(copilotId, roomId))
    return { dailyUsedUsd: s.dailyUsedUsd, monthlyUsedUsd: s.monthlyUsedUsd }
  }

  private startOfNextMonth(ms: number): number {
    const d = new Date(ms)
    d.setUTCMonth(d.getUTCMonth() + 1, 1)
    d.setUTCHours(0, 0, 0, 0)
    return d.getTime()
  }

  private startOfDay(nowMs: number): number {
    const d = new Date(nowMs)
    d.setUTCHours(0, 0, 0, 0)
    return d.getTime()
  }

  private startOfMonth(nowMs: number): number {
    const d = new Date(nowMs)
    d.setUTCDate(1)
    d.setUTCHours(0, 0, 0, 0)
    return d.getTime()
  }
}
