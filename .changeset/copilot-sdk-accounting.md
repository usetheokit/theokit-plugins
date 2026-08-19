---
'@theokit/plugin-copilot': minor
---

Delegate spend accounting to `@theokit/sdk` and become a real TheoKit plugin.

Cost is now priced from the tokens the SDK actually reports, fixing a ceiling that never
moved because it was reconciled against a field no agent produces (#61). The local budget
tracker is replaced by the SDK's budget engine, keeping only what the SDK has no equivalent
for: in-flight holds across the check-then-charge gap, and a per-request cap. `copilot()`
returns a plugin `theo.config.ts` accepts, publishing read-only usage on `ctx.copilot`.

Breaking: `monthlyUsd` is a rolling 30-day window rather than a calendar month. Use
`perRoom.limits` with the SDK's own windows where the exact boundary matters.
