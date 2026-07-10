---
slug: architecture-remediation-m1
milestone_id: M1
created_at: 2026-07-10
goal: Resolve the one critical structural defect + surgical normalizations from the 2026-07-10 architecture audit, and unblock the pre-existing plugin-voice theokit-M31 breakage, leaving the full workspace gate 100% green — without altering any package's public runtime API.
---

# Plan — M1 Architecture remediation

## Goal

Deliver milestone **M1** (`ROADMAP.md`): fix the single critical structural defect
(canvas circular dependency) and the three low-severity behavior-preserving
normalizations surfaced by the 2026-07-10 architecture audit (`architect-output/REPORT.md`,
verdict KEEP 88/100), **and** repair the pre-existing `plugin-voice` breakage
discovered during this cycle's discovery phase, so that the **full workspace gate is
100% green with evidence**. No package's public runtime API changes.

## Baseline Context

| Area | File(s) | LoC | Current state | Verified |
|---|---|---|---|---|
| Canvas cycle | `packages/plugin-canvas/src/ui/canvas-panel.tsx` (410) · `canvas-toolbar.tsx` · `ui/index.ts` | — | `canvas-panel.tsx:13` defines `CanvasPanelToolbarAction`; `canvas-toolbar.tsx:4` `import type`s it back → cycle. `canvas-panel.tsx:9` value-imports `CanvasToolbar`. `ui/index.ts:13` re-exports the type. | `madge --circular` = **1 cycle** |
| Voice server files | `packages/plugin-voice/src/{stt-server,tts-server}.ts` | — | At `src/` root; imported only by `src/index.ts` (barrel re-export) + 2 tests. `package.json` exports only `.` and `./ui` (no `./server` subpath). | grep + exports map |
| Voice theokit breakage | `packages/plugin-voice/src/index.ts:28,83` | — | Imports `defineTheoPlugin` from the **deprecated** `theokit/server` umbrella. theokit M31 internalized `defineTheoPlugin`/`definePlugin` (`plugin()` builder is the public surface). `TheoPlugin` **type** stays public via `theokit/server/define`. `defineTheoPlugin` was a pure identity fn (`return plugin`). | runtime `typeof === undefined`; full-suite baseline = **only voice fails, 2 tests** |
| Email provider | `packages/plugin-email/src/provider.ts:26` | 3 | `defineEmailProvider` = `return impl` (no validation). Sibling `defineRealtimeProvider` (`plugin-realtime/src/provider.ts:33`) validates name + each method with typed `TypeError`. `EmailProvider = { name, send }`. | Read |
| Naming conventions | `.claude/rules/architecture.md` | — | No documented convention for React-surface folder (`ui/` vs `react/`) or file casing. | Read |

**Full workspace baseline (pre-M1):** 10/11 packages green — auth-github 13, auth-google 25,
auth-magic-link 24, canvas 217, copilot 92(+1 skip), db-drizzle 35, email 32, forms 18,
payments 60, realtime 57 = **659 passing**. plugin-voice: 86 passing / **2 failing** (EC-6 scaffold).

### Files that will be touched

| File | Task | Change kind |
|---|---|---|
| `packages/plugin-voice/src/index.ts` | T0 | edit import + return typed object |
| `packages/plugin-canvas/src/ui/canvas-panel-actions.ts` | T1 | **new** leaf module |
| `packages/plugin-canvas/src/ui/canvas-panel.tsx` | T1 | import type from leaf; drop local def |
| `packages/plugin-canvas/src/ui/canvas-toolbar.tsx` | T1 | repoint type import to leaf |
| `packages/plugin-canvas/src/ui/index.ts` | T1 | re-export type from leaf |
| `packages/plugin-voice/src/server/{stt,tts}-server.ts` | T2 | **move** from `src/` |
| `packages/plugin-voice/tests/{stt,tts}-server.test.ts` | T2 | rewire import path |
| `packages/plugin-email/src/provider.ts` | T3 | add validation guards |
| `packages/plugin-email/tests/provider.test.ts` | T3 | add negative-case tests |
| `.claude/rules/architecture.md` | T4 | append § 7 naming conventions |

### Current callers / dependents

- `CanvasPanelToolbarAction`: imported by `canvas-toolbar.tsx:4` (→ cycle) and re-exported by `ui/index.ts:13`; used internally in `canvas-panel.tsx:36`. **No external consumer** references it except via the `@theokit/plugin-canvas/ui` public barrel.
- `stt-server.ts`/`tts-server.ts`: imported only by `plugin-voice/src/index.ts` (re-exported through the `.` barrel) and by 2 colocated tests. No other package imports them.
- `defineTheoPlugin`: used **only** by `plugin-voice/src/index.ts` across the whole monorepo (grep-verified).
- `defineEmailProvider`: public export of `@theokit/plugin-email`; consumers pass a custom provider. Two existing pass-through tests exercise it.

### Domain glossary

- **Leaf module** — a module that imports nothing from its own package; used to break an import graph cycle (T1).
- **Wiring triad** — caller + integration test + runtime evidence; a task is not done without all three.
- **Barrel re-export** — an `index.ts` that re-exports names so an internal file move keeps the public surface stable.
- **M31 (theokit)** — the theokit release that made `plugin()` the public plugin-authoring surface and internalized `defineTheoPlugin`/`definePlugin`.

### Architecture boundaries affected

Each package is an independent `@theokit/*` library; public surface = its
`package.json#exports`. Internal file moves that keep the same barrel re-exports do **not**
change the public API. `@theokit/plugin-canvas` exports `.`/`./ui`/`./server`;
`@theokit/plugin-voice` exports `.`/`./ui` (no `./server`). `ui/` vs `react/` are **public
subpath exports** (frozen — unifying them is a breaking change). No task in this plan alters
any `exports` map.

## Dependencies (Rule 9 — reuse, no new deps)

| Dep | Version | Status | Rule-9 note |
|---|---|---|---|
| `theokit` | linked `../../theokit/packages/theo` (0.23.1) | already a peer/dev dep | Reuse its **current public** API (`TheoPlugin` type from `theokit/server/define`); no new dep, no reimplementation. |
| `madge` | global (on PATH) | present | Cycle-proof tool; no install. |
| `vitest` / `tsup` / `tsc` / `eslint` | per-package + root | present | Existing toolchain. |

No new dependency is added. No CVE surface changes.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| Canvas circular dependency eliminated (madge=0) | T1 |
| Voice server files relocated to `src/server/` (internal-only) | T2 |
| `defineEmailProvider` fail-fast validation (TDD) | T3 |
| Naming conventions documented | T4 |
| Pre-existing voice theokit-M31 breakage repaired | T0 |
| Full workspace gate 100% green + evidence | T5 (+ every task's local gate) |
| No public runtime API change | T1,T2,T0 acceptance criteria (export parity) |

## Tasks

### Phase 0 — Unblock the baseline

#### T0 — Repair plugin-voice `defineTheoPlugin` breakage (theokit M31)

**Why this step.** DoD bullet "full workspace green" is impossible while 2 voice tests
fail. Root cause: `theokit/server` umbrella no longer exports the `defineTheoPlugin`
value (M31 builder-only). The wrapper was a pure identity — removing it is behavior-preserving.

**TDD.** The failing tests already exist and act as RED: `tests/scaffold.test.ts` EC-6
(`succeeds when both keys are passed explicitly via opts (no env)`, `reads from a custom
envVar when provided`) currently fail with `TypeError: defineTheoPlugin is not a function`.
GREEN = both pass after the fix. `test_voicePlugin_returns_valid_TheoPlugin_without_deprecated_import`.

**Change.** In `packages/plugin-voice/src/index.ts`: replace
`import { defineTheoPlugin, type TheoPlugin } from 'theokit/server'` with
`import type { TheoPlugin } from 'theokit/server/define'`; in `voicePlugin()` return a
plain `const plugin: TheoPlugin = { name, register() {…} }` (drop the identity wrapper).

**Acceptance criteria.**
- [ ] `pnpm --filter @theokit/plugin-voice test` → **0 failing** (88/88).
- [ ] `pnpm --filter @theokit/plugin-voice build` + root `typecheck` green.
- [ ] Public exports of `@theokit/plugin-voice` unchanged (default export still a `voicePlugin` factory returning `{name, register}`).
- [ ] `behavior_change=none` (identity wrapper was a runtime no-op).

### Phase 1 — Critical defect

#### T1 — Break the canvas circular dependency

**Why this step.** The only critical audit finding; blocks safe extension of `ui/`.

**TDD.** `test_canvas_ui_has_zero_circular_dependencies` — RED = `madge --circular` reports
1 cycle now; GREEN = 0 cycles after extraction. Existing 217 canvas tests must stay green
(behavior preservation).

**Change.** Create leaf `packages/plugin-canvas/src/ui/canvas-panel-actions.ts` exporting
`export type CanvasPanelToolbarAction = 'copy' | 'download' | 'fork' | 'close'` (zero
imports). `canvas-panel.tsx`: `import type { CanvasPanelToolbarAction } from './canvas-panel-actions.js'`
(remove its own definition). `canvas-toolbar.tsx:4`: import the type from the leaf, not from
`./canvas-panel.js`. `ui/index.ts`: re-export the type from the leaf (public name preserved).

**Acceptance criteria.**
- [ ] `madge --circular --extensions ts,tsx packages/plugin-canvas/src` → **0 cycles**.
- [ ] `@theokit/plugin-canvas/ui` still exports `CanvasPanelToolbarAction` (public parity).
- [ ] canvas build + 217 tests green. `behavior_change=none`.

### Phase 2 — Normalizations

#### T2 — Relocate voice server files into `src/server/`

**Why this step.** Audit cohesion finding (voice 4/5): server files at root vs canvas's clean `server/`.

**TDD.** `test_voice_server_files_live_under_src_server` (structural) + existing
`stt-server.test.ts`/`tts-server.test.ts` must stay green after import rewire.

**Change.** `git mv src/{stt-server,tts-server}.ts src/server/`; rewire imports in
`src/index.ts` (`./stt-server.js` → `./server/stt-server.js`) and the 2 tests
(`../src/stt-server.js` → `../src/server/stt-server.js`). No `./server` public subpath added.

**Acceptance criteria.**
- [ ] Files under `src/server/`; `grep -r "'./stt-server" src` = 0 stale paths.
- [ ] voice build + all voice tests green. `package.json#exports` unchanged. `behavior_change=none`.

#### T3 — `defineEmailProvider` fail-fast validation (TDD, `behavior_change=minor`)

**Why this step.** Audit pattern nit: email helper is a bare identity vs realtime's validating sibling. Fail-fast at wiring beats a mid-`send()` crash.

**TDD — RED first.** Add negative-case tests to `packages/plugin-email/tests/provider.test.ts`
asserting the *specific* `TypeError` messages: `defineEmailProvider(null)`,
`defineEmailProvider({} as any)` (missing name), `defineEmailProvider({name:''})` (empty name),
`defineEmailProvider({name:'x'} as any)` (missing send). These fail against the current
pass-through. `test_defineEmailProvider_rejects_missing_send_with_typed_error`.

**GREEN.** Mirror `defineRealtimeProvider`: guard `impl` is a non-null object, `name` is a
non-empty string, `send` is a function — each throwing `TypeError("defineEmailProvider: …")`.
Keep `return impl` (existing pass-through tests: `provider === impl` still holds).

**Acceptance criteria.**
- [ ] New negative-case tests present and green; the 2 existing pass-through tests still green.
- [ ] email build + 32→(32+N) tests green. Public signature `(impl: EmailProvider) => EmailProvider` unchanged.

### Phase 3 — Docs + gate

#### T4 — Document naming conventions (forward-only, docs)

**Why this step.** Audit medium: `ui/` vs `react/` split confuses newcomers; needs a one-line convention note (not a mass rename — case-only renames are a git/FS hazard).

**Change.** Append a "§ 7 — Naming conventions (theokit-plugins)" to `.claude/rules/architecture.md`:
new React surfaces publish `./react`; internal files kebab-case; existing `./ui`/`./react`
public subpaths are frozen. No code change.

**Acceptance criteria.**
- [ ] Convention documented; `check_xrefs.py` (if it validates the rule) stays green.

#### T5 — Full workspace gate + evidence

**Why this step.** The milestone's own DoD; the acceptance oracle.

**Acceptance criteria (evidence captured to the implementation log).**
- [ ] `pnpm -r build` green (11/11).
- [ ] `pnpm -r test` green (**661/661**, 0 failing — 659 baseline + 2 recovered voice).
- [ ] `pnpm typecheck` green.
- [ ] `pnpm lint` (`--max-warnings=0`) green.
- [ ] `madge --circular …plugin-canvas/src` = 0.
- [ ] Affected package CHANGELOGs + root `[Unreleased]` updated.

## Test Plan

- **Unit/negative:** T3 negative-case typed-error tests (new). T0 relies on the existing EC-6 tests as RED.
- **Structural:** T1 madge cycle-count assertion; T2 file-location + stale-import grep.
- **Regression (behavior preservation):** full per-package suites stay green after each task (canvas 217, voice 88, email 32+).
- **Integration:** existing per-package integration tests (email/integration, canvas server) unaffected.
- **Edge vs negative (rules/testing.md §4.1):** T3 covers negative cases (invalid provider shapes → typed error); T1/T2 are structural with regression guards.

## Drawbacks & Risks

| # | Risk / Drawback | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Case-only file renames are a git/FS hazard on case-insensitive filesystems | low | medium | Naming change is forward-only (T4 is docs); no rename of existing PascalCase files. |
| 2 | Public export-map drift breaks downstream consumers | low | high | T0/T1/T2 keep barrels re-exporting the same names; export parity is an explicit acceptance criterion on each task; no `exports` map is touched. |
| 3 | theokit link volatility — T0 depends on `theokit/server/define` exposing the `TheoPlugin` type | low | medium | Type-only import (erased at build, no runtime coupling); verified against the linked theokit 0.23.1 `.d.ts`. |
| 4 | T3 moves a failure earlier (`behavior_change=minor`) — malformed provider now throws at `defineEmailProvider()` not first `send()` | medium | low | Intended fail-fast; covered by new negative-case tests; documented in the email CHANGELOG. |
| 5 | Regression in the 659 green tests from the refactors | low | high | Each task re-runs its package suite; T5 re-runs the full workspace suite as the acceptance oracle. |

## Unresolved Questions

(none — every decision is resolved at plan time; discovery verified the exact file/line state and the theokit public-API surface at ≥95% confidence.)

## Prior Art

- `architect-output/REPORT.md` + `architect-output/proposal.md` + `architect-output/migration-plan.md` (this cycle's audit).
- `packages/plugin-realtime/src/provider.ts` — the canonical validating `define*Provider` to mirror (T3).
- theokit M31 `plugin()` builder migration note: `…/theokit/packages/theo/src/server/index.ts:188`.
