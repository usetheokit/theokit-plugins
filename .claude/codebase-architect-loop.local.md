---
active: false
target: /home/paulo/Projetos/usetheo/theokit-tools/theokit-plugins
scope: ''
current_phase: 6
phase_name: report_complete
phase_iteration: 1
global_iteration: 1
max_global_iterations: 80
completion_promise: CODEBASE ARCHITECTURE AUDIT COMPLETE
started_at: '2026-07-10T10:55:47Z'
output_dir: /home/paulo/Projetos/usetheo/theokit-tools/theokit-plugins/architect-output
db_path: /home/paulo/Projetos/usetheo/theokit-tools/theokit-plugins/architect-output/codebase-architect.db
mode: full
severity_threshold: high
modules_total: 0
cohesion_findings_total: 0
coupling_findings_total: 0
naming_findings_total: 0
pattern_findings_total: 0
boundary_findings_total: 0
migration_steps_total: 0
architect_findings_total: 0
findings_critical: 0
findings_high: 0
---

# FAANG-Level Codebase Architecture Audit

You are running an autonomous codebase architecture audit. Think like a
senior/staff software engineer reviewing a production-grade repository for
structural health, maintainability, and safe refactorability.

Your job is NOT to rewrite business logic. Your job is to analyze, diagnose,
and propose incremental structural improvements backed by evidence.

## Engagement parameters

- **Target:** `/home/paulo/Projetos/usetheo/theokit-tools/theokit-plugins`
- **Scope:** ``
- **Mode:** `full`
- **Output directory:** `/home/paulo/Projetos/usetheo/theokit-tools/theokit-plugins/architect-output`
- **Database:** `/home/paulo/Projetos/usetheo/theokit-tools/theokit-plugins/architect-output/codebase-architect.db`
- **Severity threshold:** `high`
- **Completion promise:** `CODEBASE ARCHITECTURE AUDIT COMPLETE`
- **Max iterations:** `80`

## Tool availability

| Ecosystem | Tool               | Status  | Use for                                   |
| --------- | ------------------ | ------- | ----------------------------------------- |
| Python    | pydeps             | present | Dependency graph visualization            |
| Python    | import-linter      | present | Contract-based import enforcement         |
| Python    | tach               | absent  | AST boundary enforcement (Rust-powered)   |
| TS/JS     | madge              | present | Circular dependency detection             |
| TS/JS     | skott              | absent  | Dependency graph + circular deps          |
| TS/JS     | dependency-cruiser | present | Rule-based dependency validation          |
| TS/JS     | fallow             | absent  | Composite health score + boundary presets |
| Go        | goda               | absent  | Package dependency analysis               |
| Rust      | cargo-modules      | absent  | Module dependency tree                    |
| Rust      | cargo-coupling     | absent  | Khononov 3D coupling (S-F grade)          |
| Cross     | scc                | present | LOC + complexity counting                 |
| Cross     | tokei              | absent  | LOC counting                              |
| Cross     | piranha            | absent  | Stale feature flag cleanup (Uber)         |

## The 7 scoring dimensions (0-100 total)

| #   | Dimension              | Weight | What to evaluate                                                                    |
| --- | ---------------------- | ------ | ----------------------------------------------------------------------------------- |
| 1   | **Folder Clarity**     | 20     | Semantic naming, discoverability, depth, findability for new contributors           |
| 2   | **Cohesion**           | 20     | Each module has one clear responsibility; files grouped by behavior not type        |
| 3   | **Coupling**           | 20     | No circular deps, correct import direction, no infrastructure leakage into domain   |
| 4   | **Pattern Fit**        | 15     | Appropriate patterns used; no cargo-culting; missing beneficial patterns identified |
| 5   | **Testability**        | 10     | Can modules be tested in isolation? Clear seams for mocking?                        |
| 6   | **Scalability**        | 10     | Can new features be added without touching unrelated modules?                       |
| 7   | **Onboarding Clarity** | 5      | Can a new developer find what they need in <5 minutes?                              |

## Mode contract

| Mode      | Phases executed  | Skipped |
| --------- | ---------------- | ------- |
| full      | 1, 2, 3, 4, 5, 6 | none    |
| diagnosis | 1, 2, 6          | 3, 4, 5 |
| patterns  | 1, 2, 3, 6       | 4, 5    |
| proposal  | 1, 2, 3, 4, 6    | 5       |
| migration | 1, 2, 3, 4, 5, 6 | none    |

## Operating rules

1. **Sub-agents per phase.** Each phase is delegated to a specialist agent:
   chief-architect-organizer (Phase 1), structure-scanner + coupling-detector (Phase 2),
   pattern-assessor (Phase 3), architecture-proposer (Phase 4),
   refactor-planner (Phase 5), quality-evaluator (gates), report-writer (Phase 6).

2. **Database is source of truth.** Every finding MUST be persisted via the
   database CLI before advancing. No finding lives only in markdown.

3. **Structured-column rule.** All `add-*-finding` commands MUST include `file`
   as a non-NULL key. NULL file values fail the quality gate.

4. **Evidence-backed only.** Every recommendation MUST cite concrete files,
   imports, or dependencies. Never invent architecture that the repo does not
   support.

5. **Confidence threshold.** Below 80% confidence: propose investigation, not
   implementation. Mark findings with `confidence` field.

6. **Behavior preservation.** Every proposed change MUST have `behavior_change`
   tagged as `none`, `minor`, or `risky`. Prefer `none`.

7. **Incremental over revolutionary.** Prefer safe moves over large rewrites.
   Each migration step must be independently verifiable.

8. **Markers from DB queries.** The chief-architect-organizer emits phase
   markers by querying the database, NEVER from sub-agent text.

9. **No pattern theater.** Do not recommend Clean Architecture, Hexagonal, or
   any pattern unless it concretely reduces complexity. Simple structure that
   works is better than elegant structure that nobody maintains.

10. **Crying Wolf prevention.** Fewer high-confidence findings beat many
    speculative ones. Every finding must explain WHY it matters.

## Database CLI reference

```bash
DB="/home/paulo/Projetos/usetheo/theokit-tools/theokit-plugins/architect-output/codebase-architect.db"
DB_CLI="${CLAUDE_PLUGIN_ROOT}/scripts/codebase_architect_database.py"

python3 "$DB_CLI" --db-path "$DB" add-module --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-file --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-cohesion-finding --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-coupling-finding --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-naming-finding --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-pattern-finding --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-boundary-finding --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-migration-step --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-architecture-score --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-architect-finding --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-meeting --json '{...}'
python3 "$DB_CLI" --db-path "$DB" add-quality-gate --json '{...}'
python3 "$DB_CLI" --db-path "$DB" count --table TABLE [--where CLAUSE --params '[...]']
python3 "$DB_CLI" --db-path "$DB" coverage-stats
python3 "$DB_CLI" --db-path "$DB" scoring-summary
python3 "$DB_CLI" --db-path "$DB" thresholds
```

---

## Phase guide

### Phase 1 — Discovery (chief-architect-organizer)

Inspect the repository structure:

- Root files (README, config, manifests, Dockerfile)
- Source directories + test directories
- Dependency files (package.json, go.mod, pyproject.toml, Cargo.toml)
- Framework conventions (Django, FastAPI, Next.js, Gin, etc.)
- Entry points and public APIs
- Import graph structure

Register every module via `add-module` with `layer`, `domain_tag`, `responsibility`.
Register files via `add-file`.

Produce: current architecture summary, detected architectural style, risk areas.

### Phase 2 — Structural Diagnosis (structure-scanner + coupling-detector)

**Cohesion analysis** (structure-scanner):

- Does each folder contain one clear responsibility?
- Are files grouped by behavior or by arbitrary type?
- Score each module 1-5 on cohesion

**Coupling analysis** (coupling-detector):

- Circular dependencies (always critical)
- Wrong-direction imports (low-level importing high-level)
- Infrastructure leaking into domain code
- Cross-layer violations

**Naming analysis** (structure-scanner):

- Generic folders: utils, helpers, common, manager, service
- Misleading names, non-discoverable paths
- Inconsistent naming conventions

**Boundary analysis** (coupling-detector):

- Domain/application/infrastructure layer separation
- Test colocation consistency
- Internal modules hidden from public API

### Phase 3 — Pattern Review (pattern-assessor)

For each relevant design pattern:

- Present and correctly used?
- Present but misapplied or overused?
- Missing but would concretely reduce complexity?
- Cargo-culted (applied without the problem it solves)?

Patterns to evaluate: Layered, Hexagonal, Clean, Modular Monolith,
Feature-Sliced, Repository, Factory, Strategy, Adapter, Facade, Command,
Builder, Dependency Injection.

Rule: recommend patterns ONLY when they reduce complexity.

### Phase 4 — Target Architecture Proposal (architecture-proposer)

Produce:

- Proposed directory tree
- Responsibilities per folder
- Migration steps
- Risks and compatibility notes
- Which changes are behavior-preserving

### Phase 5 — Refactor Plan (refactor-planner)

Generate incremental plan with 6 step types:

1. Safe moves only (behavior_change: none)
2. Import rewiring (behavior_change: none)
3. Boundary enforcement (behavior_change: none)
4. Dead code cleanup (behavior_change: minor)
5. Pattern extraction (behavior_change: minor)
6. Tests and verification (behavior_change: none)

Each step: objective, files affected, expected behavior change,
risk level, validation command.

### Phase 6 — Report (report-writer)

Consolidate all findings into the final report with:

- Executive summary
- Architecture score (0-100)
- Current structure diagnosis
- Concrete problems with file evidence
- Cohesion analysis (1-5 per module)
- Coupling analysis
- Design pattern assessment
- Proposed folder structure
- Incremental migration plan
- Validation checklist
- Final verdict: Keep / Refactor Lightly / Refactor Boundaries / Major Cleanup
