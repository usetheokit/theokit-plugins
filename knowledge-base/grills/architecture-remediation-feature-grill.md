---
slug: architecture-remediation
generated_by: roadmap-feature
date: 2026-07-10
status: completed
new_milestone_id: M1
roadmap_conversion: true
source_of_answers: architecture audit 2026-07-10 (architect-output/REPORT.md, migration-plan.md)
---

# Feature grill — architecture-remediation (→ M1)

> **Context.** `/roadmap-feature` was invoked with "CRIE MILESTONES PARA CORRIGIR
> TODOS OS PONTOS QUE VOCE ENCONTROU". Two blockers were surfaced honestly to the
> user: (1) this repo's `ROADMAP.md` had no milestone-checkbox format (parse
> failed at Step 0.4) and no `## State-of-the-art references` anchor; (2) the audit
> findings are internal refactors, which the skill routes to ad-hoc mode. The user
> chose **"Convert ROADMAP to milestones"** + **"1 cohesive unit"**. The four grill
> questions are answered from the audit evidence (not re-asked) because the audit
> already resolved every dimension at 95%+ confidence; provenance is cited per answer.

## Q1 — What is this feature and why now?

**Answer.** Architecture remediation of the four findings from the 2026-07-10
FAANG-level architecture audit (loop-codebase-architect, score 88/100, verdict
**KEEP**): one critical structural defect (canvas circular dependency) plus three
low-severity behavior-preserving normalizations. **Why now:** the audit context is
fresh, and the canvas cycle should be broken before the `ui/` surface is extended
further (each new renderer/toolbar action compounds the cycle's blast radius).
*Provenance:* `architect-output/REPORT.md` §1, §4.

## Q2 — Which existing milestone(s) must be `[x]` first?

**Answer.** **M0** — the shipped plugin cluster (11 packages, `@theokit/sdk` 2.18.0
alignment). The remediation refactors code that M0 delivered; the cluster must
exist and be green before it can be normalized. *Provenance:* ROADMAP Status
section (11 plugins shipped 2026-07-03).

## Q3 — Verifiable Definition of Done (3-5 bullets)?

**Answer.** (see M1 DoD in ROADMAP.md — 5 bullets):
1. Canvas cycle eliminated (`madge --circular` = 0 cycles; public export unchanged).
2. `plugin-voice` server files relocated to `src/server/` (internal-only, tests green).
3. `defineEmailProvider` fail-fast validation (RED regression test before GREEN).
4. Naming conventions documented in `rules/architecture.md` (forward-only; no mass rename).
5. Full workspace gate green (build/test/typecheck/lint) + affected CHANGELOGs updated.
*Provenance:* `architect-output/migration-plan.md` (8 ordered steps).

## Q4 — Top 2 NEW risks introduced?

**Answer.**
1. **Case-only file renames** — git/FS hazard on case-insensitive filesystems.
   Mitigation: naming changes are forward-only; no mass rename; isolated commit if ever done.
2. **Public export-map change = breaking** for consumers. Mitigation: every move is
   internal-only (canvas re-exports the extracted type under its existing name; voice
   adds no `./server` subpath); `ui/` vs `react/` folders frozen (public subpath exports).
*Provenance:* `architect-output/proposal.md` §6 (anti-theater ledger) + migration-plan risk tags.

## Out-of-scope cross-check (Step 3)

The pre-existing ROADMAP has no `### Explicitly out of scope` section (milestone
template sense). Its "Exclusions" / "demand-gated" lists concern **new plugins**;
M1 touches only **existing** package internals (refactor). **No overlap** — no
out-of-scope item revisited.

## SOTA delta (Step 5)

**No** — the audit was internal static analysis (madge/depcruise + code reading);
no external reference peers were cloned. `## State-of-the-art references` anchor
added to ROADMAP.md with an explanatory row (anchor required for future
`/roadmap-feature` runs), no peers.
