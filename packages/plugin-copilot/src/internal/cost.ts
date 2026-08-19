/**
 * @theokit/plugin-copilot — turning a completed stream into dollars (#61, #62).
 *
 * The runtime used to read `evt.usage?.costUsd` and reconcile the budget to it. No
 * agent produces that field: `@theokit/sdk`'s `StreamObjectEvent` reports
 * `usage: { inputTokens, outputTokens }`, and `costUsd` appears nowhere in the SDK.
 * So the branch was unreachable and every invocation settled at the configured
 * estimate — a spend ceiling checked against a number that never moved.
 *
 * Pricing is not ours to own. `computeCost` ships with the SDK, backed by a versioned
 * pricing snapshot, and reimplementing a rate table here would be a second source of
 * truth that drifts the first time a provider changes a price.
 *
 * @internal
 */

import { computeCost as sdkComputeCost } from '@theokit/sdk'

/**
 * What `computeCost` returns, annotated here because the SDK's own declaration does not
 * resolve.
 *
 * `@theokit/sdk@2.18.0` ships a broken `.d.ts`: `dist/cron-*.d.ts` references
 * `MemoryProviderFactory`, a name defined nowhere in the package. `tsc` hides it behind
 * `skipLibCheck`, but typescript-eslint degrades every type reached through that graph to
 * `error`, so `computeCost(...)` reads as unresolvable and every field access on it is an
 * unsafe-member-access.
 *
 * This is NOT the hand-maintained mirror that #62 removed, and the difference matters: that
 * one copied a type the SDK exports correctly and could have imported. Here there is
 * nothing to import until upstream fixes the declaration — reported separately. The shape
 * below is only the three fields this module reads, so a change to the rest of
 * `CostBreakdown` cannot silently invalidate it, and `settleCost`'s own tests price a real
 * call end to end.
 */
interface CostBreakdownShape {
  readonly amountUsd: number | undefined
  readonly status: string
  readonly source: string | undefined
  readonly pricingVersion: string | undefined
}

/**
 * The unresolvable type is crossed here, once, and never again below.
 *
 * A cast at each field read would put four unchecked assumptions in the module and let
 * them drift apart. One typed binding at the import means the call site is ordinary
 * checked code, and there is a single line to delete when upstream ships a working
 * declaration.
 */
const computeCost = sdkComputeCost as (args: {
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  provider: string
  model: string
}) => CostBreakdownShape

import type { CopilotUsage } from '../types.js'

/**
 * What a settled invocation cost, and how sure we are.
 *
 * `amountUsd: undefined` is a first-class answer, not a failure. `computeCost` returns
 * no amount when it has no pricing for the model — a self-hosted endpoint, a model
 * newer than the snapshot — and the caller must fall back to its estimate rather than
 * charge zero. Charging zero for an unpriced model would make the ceiling silently
 * infinite, which is worse than the bug this replaces.
 */
export interface SettledCost {
  readonly amountUsd: number | undefined
  /** `computeCost`'s own status, or `no_usage` when the event carried none. */
  readonly status: string
  /** Where the number came from, for the audit trail an ops team reads. */
  readonly source: string | undefined
  readonly pricingVersion: string | undefined
}

const NO_USAGE: SettledCost = {
  amountUsd: undefined,
  status: 'no_usage',
  source: undefined,
  pricingVersion: undefined,
}

/**
 * Split a model id into the provider and the model the pricing table knows.
 *
 * TheoKit model ids are `provider/rest`, and `rest` may itself contain slashes —
 * `openrouter/openai/gpt-4o-mini` is provider `openrouter`, model `openai/gpt-4o-mini`.
 * Splitting on every slash would ask the table for `openai`, which is a provider name,
 * not a model, and quietly return no price.
 */
export function splitModelId(model: string | { readonly id: string }): {
  provider: string
  model: string
} {
  const id = typeof model === 'string' ? model : model.id
  const slash = id.indexOf('/')
  if (slash <= 0 || slash === id.length - 1) {
    // No provider prefix. Hand the whole thing over and let the table decide; a wrong
    // guess here would be a fabricated provider, which is worse than an unpriced call.
    return { provider: '', model: id }
  }
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) }
}

/**
 * Price a completed invocation from the token counts the SDK reported.
 *
 * Never throws: a pricing lookup failing must not fail the user's request, which has
 * already succeeded by the time this runs. An unpriced call settles at the caller's
 * estimate and says so through `status`.
 */
export function settleCost(
  usage: CopilotUsage | undefined,
  model: string | { readonly id: string },
): SettledCost {
  if (usage === undefined) return NO_USAGE

  // An agent that already knows its own cost wins — it saw the provider's invoice line,
  // and no table beats that. This is the path a custom `CopilotAgentLike` takes.
  if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) {
    return {
      amountUsd: usage.costUsd,
      status: 'reported',
      source: 'agent',
      pricingVersion: undefined,
    }
  }

  const { inputTokens, outputTokens } = usage
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return NO_USAGE

  const { provider, model: modelName } = splitModelId(model)
  try {
    const breakdown = computeCost({
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      provider,
      model: modelName,
    })
    return {
      amountUsd: typeof breakdown.amountUsd === 'number' ? breakdown.amountUsd : undefined,
      status: breakdown.status,
      source: breakdown.source,
      pricingVersion: breakdown.pricingVersion,
    }
  } catch {
    // `computeCost` is a pure lookup, but it is still someone else's code running on the
    // success path of a request that already completed. Degrading to the estimate is the
    // only behaviour that cannot make things worse.
    return {
      amountUsd: undefined,
      status: 'pricing_error',
      source: undefined,
      pricingVersion: undefined,
    }
  }
}
