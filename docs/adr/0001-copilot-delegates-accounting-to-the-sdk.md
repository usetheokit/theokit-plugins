# ADR 0001 — `plugin-copilot` delegates spend accounting to `@theokit/sdk`

- **Status**: accepted
- **Date**: 2026-08-19
- **Closes**: [#62](https://github.com/usetheokit/theokit-plugins/issues/62), [#61](https://github.com/usetheokit/theokit-plugins/issues/61)
- **Supersedes**: the `plugin-copilot` entry in `scripts/validate-manifests.mjs` `PEER_WITHOUT_USE_EXEMPT` (deferred from [#42](https://github.com/usetheokit/theokit-plugins/issues/42) item 3)

## Why this is written down here

`.claude/knowledge-base/adrs/` is the kit's location and is excluded by `.gitignore`, so a
decision recorded there does not survive a plugin reinstall and never reaches a consumer
reading the repository. This decision changes a published package's public types, so it
lives in the tree.

## Context

`plugin-copilot` puts an agent in a realtime room as a presence-visible member. Triggers
fire it on room frames — `broadcast:*`, `presence:idle` — so it spends money **on its own
initiative**, without a human in the loop. `budget` is the brake on that loop.

Three facts, all measured against `@theokit/sdk@2.18.0`:

1. **The brake was checking a number that never moved.** `runtime.ts` reconciled spend from
   `evt.usage?.costUsd`. `grep -c costUsd` over the SDK's type surface returns **0**. The
   real event carries `usage: { inputTokens, outputTokens }`. The branch was unreachable,
   so every invocation settled at the configured estimate (#61).

2. **The accounting was a second implementation.** `budget-bridge.ts` kept its own `Map` of
   per-room state, its own daily and monthly counters, its own UTC window arithmetic and
   reset logic — 217 lines importing nothing. Its own header called it _"Simplified
   in-memory implementation for v0.1 — production deployments should wire SDK Budget
   (D375-D388) directly"_. The SDK ships calendar-aligned windows, stacked limits, 80/95/100%
   thresholds, `audit`/`warn`/`block` modes and a named registry.

3. **The peer was declared and unused.** `src/` imported nothing from `theokit` or
   `@theokit/sdk` while requiring both.

(1) is a consequence of (2) and (3): a hand-maintained mirror of someone else's type drifts,
and nothing was positioned to notice.

## Decision

**Delegate accounting to the SDK. Keep only what the SDK does not have. Import the framework
we already require.**

### 1 — The SDK owns the ledger

`Budget.create` / `preflightCheck` / `chargeAndCheckThresholds` replace the local counters.
`BudgetBridge` becomes a reservation layer over them.

### 2 — Two things stay, and are not duplication

**In-flight holds.** The SDK is check-then-charge: between `preflightCheck` and
`chargeAndCheckThresholds`, spend is invisible. For a copilot, concurrent invocations are the
normal case, and two of them would both pass a preflight neither had paid for. The hold
ledger makes an in-flight estimate visible to the next caller; `release` returns it when the
call fails (EC-2 — a failed invocation must not leak budget).

**Per-request cap.** `perRequestUsd` bounds a single call. The SDK's limits are windows, and
expressing "per call" as `1h` would be a different rule wearing the same name.

### 3 — The event type becomes a supertype of the SDK's

`CopilotAgentLike` stays structural — any object with a compatible `streamObject` works,
which is what lets a consumer bring an agent this package has never heard of. It now accepts
the SDK's `complete` event verbatim, extra fields and all, and
`tests/sdk-shape.test.ts` asserts a real `StreamObjectEvent` is assignable to it. That
assertion is what makes the mirror unable to drift again: no network, no key, no cost —
`pnpm typecheck` fails instead.

The assertion had to be written carefully to be worth anything. The first version derived
the event type with `ReturnType<CopilotAgentLike['streamObject']>`, which instantiates the
generic with `unknown` and silently drops the type parameter — so it held for every object
shape and proved nothing. Writing it as `ReturnType<typeof _agent.streamObject<T>>` passes
`T` through, and the moment it did, **it failed**: the SDK emits `partial: DeepPartial<T>`
while this package declared `partial: T`.

That was a live defect of exactly the class this ADR is about. A partial chunk carries an
incomplete object by definition, and typing it as the complete one promises consumers
fields that are not there yet — `partial.text` typed `string` when the stream has not
produced it. `partial` is now `DeepPartial<T>`, imported from the SDK rather than restated,
and removing the import turns `pnpm typecheck` red.

### 4 — Pricing comes from the SDK

`settleCost` prices the reported tokens through the SDK's `computeCost`, which is backed by a
versioned pricing snapshot. `amountUsd: undefined` is a first-class answer: when the model has
no pricing, the estimate stands. **Charging zero for an unpriced call would make the ceiling
infinite** — worse than the bug being fixed.

### 5 — The plugin becomes a `TheoPlugin`

`copilot()` returns a plugin that decorates `ctx.copilot`, the shape
`plugin-payments/src/plugin.ts` established. The surface is read-only: usage, ids, descriptor.

There is **no `invoke`**, and its absence is deliberate. A copilot is triggered by room
frames, not by HTTP, and there is no runtime method to back an invoke. Adding one would have
meant inventing an API — the exact defect #42 recorded.

## Consequences

### Accepted cost: `@theokit/sdk` becomes a runtime dependency

`Budget`, `preflightCheck`, `chargeAndCheckThresholds` and `computeCost` are values, so this
is real coupling where there was none. It is accepted because the peer was **already declared
as required** — this makes the manifest true rather than making it stricter. `theokit` itself
stays type-only (`import type`, erased at build).

### Behaviour change: `monthlyUsd` is a rolling 30-day window

The SDK's window vocabulary has no calendar month. `monthlyUsd` maps to `30d`, and the two
differ in both directions: a $100 cap spent on 1 January frees on 31 January under a rolling
window and on 1 February under a calendar month, while in a 28-day February the rolling
window still remembers January.

Mitigated rather than hidden: `perRoom.limits` accepts the SDK's own windows
(`1h`/`1d`/`1w`/`30d`/`365d`) for callers who need precision, the field's doc comment states
the semantics, and the CHANGELOG carries it as a `Changed` entry.

### Additive: `getUsage` reports `inFlightUsd`

Committed spend and reserved-but-unsettled spend are different facts. A meter that adds them
shows a number true of neither, so they are reported apart. Additive for readers; only exact
shape assertions change.

### Removed: `BudgetBridge.charge()`

Fire-and-forget charging with no reservation. The runtime never called it; only tests did.
Keeping it would have left a second way to move the ledger, bypassing the hold accounting.

## Alternatives considered

**Fix #61 alone** — read `inputTokens`/`outputTokens` in `runtime.ts` and convert. Fixes the
bill and leaves the mirror standing, to drift again at the next field. Rejected: it treats the
symptom.

**Import `StreamObjectEvent` and require it** — abandons the structural contract that lets a
test drive a deterministic agent and a consumer bring their own. Rejected: the freedom is
real, and a supertype keeps it while pinning the shape.

**Keep a calendar-month tracker locally for `monthlyUsd`** — preserves exact behaviour and
reintroduces the duplication this ADR removes, for one window. Rejected in favour of stating
the change and exposing the SDK's vocabulary.

## Known upstream defect

`@theokit/sdk@2.18.0` ships a `.d.ts` that does not compile: `dist/cron-*.d.ts` references
`MemoryProviderFactory`, a name defined nowhere in the package. `tsc` hides it behind
`skipLibCheck`, but typescript-eslint degrades every type reached through that graph to
`error`, which is why `computeCost`'s return is annotated at the import in
`src/internal/cost.ts` instead of being inferred. That annotation is a single line to
delete once upstream is fixed; it is documented at the site rather than left to be
rediscovered.

## Verification

- `tests/sdk-shape.test.ts` — a real `StreamObjectEvent<Answer>` is assignable, with the type parameter actually flowing; the SDK usage shape prices to a non-zero amount. Mutation-checked: restoring `partial: T` turns typecheck red
- `tests/budget-bridge.test.ts` — 17 cases against a real `Budget`; removing the hold check turns the concurrency case red
- `tests/integration/plugin-runner-conformance.test.ts` — `createPluginRunnerFromConfig`, the function `theo.config.ts` feeds, accepts the plugin
- `pnpm check:manifests` — passes with `plugin-copilot` removed from `PEER_WITHOUT_USE_EXEMPT`
