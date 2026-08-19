/**
 * @theokit/plugin-copilot — the reservation layer over `@theokit/sdk`'s Budget (#62).
 *
 * This file used to be a spend tracker: its own `Map` of per-room state, its own daily
 * and monthly counters, its own UTC window arithmetic and reset logic. Its header said
 * so — *"Simplified in-memory implementation for v0.1 — production deployments should
 * wire SDK Budget (D375-D388) directly"* — and that is what happens now.
 *
 * The SDK owns everything a budget is: calendar-aligned windows (`1h`/`1d`/`1w`/`30d`/
 * `365d`), stacked limits where any exceeded blocks, threshold callbacks at 80/95/100%,
 * the `audit`/`warn`/`block` modes, and a named registry. Reimplementing that here meant
 * two sources of truth for how much was spent, and the weaker one enforcing the ceiling.
 *
 * ── WHAT STAYS, AND WHY IT IS NOT DUPLICATION ─────────────────────────────────
 *
 * Two things the SDK does not have, both load-bearing for a copilot:
 *
 *   1. IN-FLIGHT HOLDS. The SDK is check-then-charge: `preflightCheck` reads committed
 *      spend, `chargeAndCheckThresholds` commits after the call returns. Between those
 *      two, spend is invisible. A copilot fires on room events — `presence:idle`,
 *      `broadcast:*` — so concurrent invocations are the normal case, not the edge, and
 *      two of them would both pass a preflight neither had paid for yet. The hold ledger
 *      below makes an in-flight estimate visible to the next caller, and `release` gives
 *      it back when the call fails (EC-2: a failed invocation must not leak budget).
 *
 *   2. PER-REQUEST CAP. `perRequestUsd` bounds a single invocation. The SDK's limits are
 *      windows; there is no "per call" window, and expressing one as `1h` would be a
 *      different rule wearing the same name.
 *
 * @internal
 */

import { Budget, chargeAndCheckThresholds, preflightCheck } from '@theokit/sdk'
import type { BudgetHandle, BudgetLimit } from '@theokit/sdk'

import type { CopilotBudgetConfig } from '../types.js'
import { CopilotError } from '../types.js'

/**
 * Token returned by {@link BudgetBridge.reserve}. Holds `estimatedUsd` against the room
 * until settled exactly once — {@link BudgetBridge.reconcile} on success (charge the
 * actual) or {@link BudgetBridge.release} on failure (charge nothing).
 *
 * @internal
 */
export interface BudgetReservation {
  readonly copilotId: string
  readonly roomId: string
  readonly estimatedUsd: number
  /** Identity of the hold in the ledger; settling removes it. */
  readonly holdId: number
  settled: boolean
}

/** Budget names must match `^[a-z0-9][a-z0-9_-]*$` (SDK EC-7). */
const SDK_NAME_OK = /^[a-z0-9][a-z0-9_-]*$/

/**
 * A budget name derived from `copilotId` + `roomId`, collision-free.
 *
 * The obvious version — lowercase and replace what the grammar rejects — silently merges
 * budgets: `room:a/b` and `room:a-b` both become `room-a-b`, and two rooms then share one
 * ceiling. A ceiling that is quietly half as generous as configured is exactly the class
 * of defect this refactor exists to remove, so the raw key is fingerprinted and the digest
 * appended. Readable prefix for an operator reading `Budget.list()`, uniqueness from the
 * suffix.
 */
export function budgetNameFor(copilotId: string, roomId: string): string {
  const raw = `${copilotId}:${roomId}`
  let hash = 5381
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0
  const readable = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
  const prefix = readable.length > 0 ? readable.slice(0, 48) : 'copilot'
  const name = `${prefix}-${hash.toString(36)}`
  /* c8 ignore next 3 -- unreachable: the digest is alphanumeric and the prefix is
     sanitised, so the result always matches. Asserted rather than assumed because a
     malformed name throws inside Budget.create, far from here. */
  if (!SDK_NAME_OK.test(name))
    throw new CopilotError(`derived an invalid budget name "${name}"`, {
      code: 'budget_name_invalid',
    })
  return name
}

/** Map the plugin's per-room config onto the SDK's stacked windows. */
function limitsFrom(config: CopilotBudgetConfig | undefined): BudgetLimit[] {
  const per = config?.perRoom
  if (per === undefined) return []
  const limits: BudgetLimit[] = []
  if (per.dailyUsd !== undefined) limits.push({ window: '1d', limitUsd: per.dailyUsd })
  // `30d` is the SDK's nearest window to a calendar month. Named here rather than left
  // implicit, because `monthlyUsd` on a 30-day window is a slightly stricter promise than
  // the field name suggests in a 31-day month.
  if (per.monthlyUsd !== undefined) limits.push({ window: '30d', limitUsd: per.monthlyUsd })
  // Explicit windows come last so a caller who states one wins over the sugar for the
  // same window — the SDK stacks them and blocks on any exceeded, so a duplicate would
  // otherwise enforce whichever is stricter rather than what was written.
  for (const l of per.limits ?? []) {
    const i = limits.findIndex((x) => x.window === l.window)
    if (i >= 0) limits.splice(i, 1)
    limits.push({ window: l.window, limitUsd: l.limitUsd })
  }
  return limits
}

/**
 * Per-copilot-per-room budget: SDK accounting, local holds.
 *
 * @internal
 */
export class BudgetBridge {
  /** Estimates currently in flight, per budget name. Empty once every call settles. */
  private readonly holds = new Map<string, Map<number, number>>()
  private nextHoldId = 1

  constructor(private readonly config: CopilotBudgetConfig | undefined) {}

  private get enabled(): boolean {
    return this.config?.perRoom !== undefined
  }

  /**
   * The SDK budget for this room, created on first use.
   *
   * `Budget.create` throws on a duplicate name (SDK EC-16), and two copilots in one room
   * — or one process re-registering after a reload — reach this with the same name, so
   * the registry is consulted first. `mode: 'block'` because `preflightCheck` must
   * refuse, not warn: the caller is an agent about to spend money on its own initiative.
   */
  private handleFor(copilotId: string, roomId: string): BudgetHandle {
    const name = budgetNameFor(copilotId, roomId)
    return (
      Budget.get(name) ??
      Budget.create({ name, scope: 'agent', mode: 'block', limits: limitsFrom(this.config) })
    )
  }

  private heldFor(name: string): number {
    let total = 0
    for (const usd of this.holds.get(name)?.values() ?? []) total += usd
    return total
  }

  /**
   * Check `estimatedUsd` against the per-request cap, the in-flight holds and the SDK's
   * committed spend. Throws {@link CopilotError} or the SDK's `BudgetExceededError`.
   * No state mutation.
   */
  preflightCheck(copilotId: string, roomId: string, estimatedUsd: number): void {
    if (!this.enabled) return
    this.assertWithinLimits(this.handleFor(copilotId, roomId), estimatedUsd)
  }

  /**
   * The three checks, in the order that produces the most useful error.
   *
   * Per-request first: it is the caller's own mistake and says so without mentioning
   * windows. Then holds, which the SDK cannot see. Then the SDK itself, so its error
   * taxonomy and threshold callbacks are the ones that fire on a real window breach.
   */
  private assertWithinLimits(handle: BudgetHandle, estimatedUsd: number): void {
    const per = this.config?.perRoom
    if (per === undefined) return

    if (per.perRequestUsd !== undefined && estimatedUsd > per.perRequestUsd) {
      throw new CopilotError(
        `Budget perRequestUsd ${per.perRequestUsd} exceeded by estimate ${estimatedUsd.toFixed(4)}`,
        { code: 'budget_per_request_exceeded' },
      )
    }

    const held = this.heldFor(handle.name)
    if (held > 0) {
      for (const limit of handle.limits) {
        if (handle.remainingIn(limit.window) - held < estimatedUsd) {
          throw new CopilotError(
            `Budget ${limit.window} limit ${limit.limitUsd} would be exceeded by estimate ` +
              `${estimatedUsd.toFixed(4)} with ${held.toFixed(4)} already in flight`,
            { code: 'budget_in_flight_exceeded' },
          )
        }
      }
    }

    // Committed spend, thresholds and mode enforcement — the SDK's job, not ours.
    preflightCheck(handle.name, estimatedUsd)
  }

  /**
   * Atomically check and hold in one synchronous section — no `await` between the check
   * and the write, so two concurrent invocations cannot both pass a stale view.
   *
   * Returns a reservation that MUST be settled via {@link reconcile} or
   * {@link release}; an unsettled hold blocks the room until the process restarts.
   */
  reserve(copilotId: string, roomId: string, estimatedUsd: number): BudgetReservation {
    const holdId = this.nextHoldId++
    if (!this.enabled) {
      return { copilotId, roomId, estimatedUsd, holdId, settled: false }
    }
    const handle = this.handleFor(copilotId, roomId)
    this.assertWithinLimits(handle, estimatedUsd) // throws → nothing held, nothing to settle

    let perName = this.holds.get(handle.name)
    if (perName === undefined) {
      perName = new Map()
      this.holds.set(handle.name, perName)
    }
    perName.set(holdId, estimatedUsd)
    return { copilotId, roomId, estimatedUsd, holdId, settled: false }
  }

  /**
   * Settle on success: drop the hold and charge what it really cost.
   *
   * Idempotent. `actualUsd` comes from `settleCost` — the SDK's `computeCost` over the
   * reported tokens — falling back to the estimate when the model has no pricing.
   */
  async reconcile(reservation: BudgetReservation, actualUsd: number): Promise<void> {
    if (reservation.settled) return
    reservation.settled = true
    if (!this.enabled) return
    const name = budgetNameFor(reservation.copilotId, reservation.roomId)
    this.holds.get(name)?.delete(reservation.holdId)
    // Charge AFTER releasing the hold: the two must never both count, and the hold is
    // the one that was a guess.
    await chargeAndCheckThresholds(name, Math.max(0, actualUsd))
  }

  /**
   * Settle on failure: drop the hold, charge nothing (EC-2). Idempotent.
   */
  release(reservation: BudgetReservation): void {
    if (reservation.settled) return
    reservation.settled = true
    if (!this.enabled) return
    const name = budgetNameFor(reservation.copilotId, reservation.roomId)
    this.holds.get(name)?.delete(reservation.holdId)
  }

  /**
   * Committed spend per window, plus what is currently held.
   *
   * `inFlightUsd` is reported separately rather than folded in: an operator reading a
   * usage meter needs to know whether a number is money spent or money promised.
   */
  getUsage(
    copilotId: string,
    roomId: string,
  ): { dailyUsedUsd: number; monthlyUsedUsd: number; inFlightUsd: number } {
    if (!this.enabled) return { dailyUsedUsd: 0, monthlyUsedUsd: 0, inFlightUsd: 0 }
    const handle = this.handleFor(copilotId, roomId)
    return {
      dailyUsedUsd: handle.spentIn('1d'),
      monthlyUsedUsd: handle.spentIn('30d'),
      inFlightUsd: this.heldFor(handle.name),
    }
  }
}
