# ADR 0003 — Documented examples declare what they assume

- **Status**: accepted
- **Date**: 2026-08-23
- **Extends**: the doc-API-drift gate, which resolved imported names only

## Why this is written down here

`.claude/knowledge-base/adrs/` is the kit's location and is excluded by `.gitignore` — same
reasoning as ADR 0001 and 0002. This one has the same second reason as 0002: three files cite this
path in comments a reader will follow.

It was cited before it existed. Three source files pointed at `docs/adr/0003` while `docs/adr/`
held only 0001 and 0002, and the measurement the citation carried lived nowhere on disk. A review
caught it. Writing the file is the fix; recording that it was cited first is the point.

## Context

The gate resolved documented import **names**. It could not see a wrong signature, a dropped
option, or a method that moved.

Compiling the blocks instead sounds obvious and is not, because a compiler cannot tell these apart:

| In a README                                | What it is                                            |
| ------------------------------------------ | ----------------------------------------------------- |
| `import x from './session.js'`             | the reader's own file                                 |
| `import { OrmModule } from '@theokit/orm'` | a real package the probe had not installed            |
| `const db = yourSqliteDb`                  | a placeholder                                         |
| `withAgentContext({ userId })`             | **a genuine defect** — `AgentContext` has no `userId` |

Three attempts to count "how many blocks fail to compile" produced 2, 49 and 23. All three were
wrong for that reason. **The number cannot exist before the declarations do.**

## Decision

A block declares what it assumes, in an HTML comment above it:

```
<!-- doc-example: partial -->
<!-- doc-example: needs="@theokit/orm" needs="./session.js" -->
<!-- doc-example: continues -->
```

| Marker      | Meaning                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partial`   | Abbreviated. Parsed for syntax, never type-checked — an elision means the block cannot type-check, not that it can be anything                                                                                       |
| `needs="…"` | A module the harness stands in for. The specifier is rewritten to a stub name and declared as a shorthand ambient module, so the import resolves as `any` and **every other diagnostic in the block still surfaces** |
| `continues` | Shares scope with the preceding compilable block of the same file, which are compiled joined                                                                                                                         |

An unknown key fails the run. A typo that silently downgraded a block to the default would be the
exemption-by-silence this repository has closed twice before.

### An HTML comment, not a fence info string

Measured across 400 READMEs in the pnpm store: **0** use an info string after the language tag;
**39** use HTML comments. These are eleven published npm landing pages, and being the first of four
hundred to depend on a rendering behaviour nobody exercises is not a risk worth taking. An HTML
comment is invisible by definition rather than by hope.

### Blank lines are transparent; prose is not

Strict adjacency was the first rule. `pnpm format` inserts a blank line between an HTML comment and
the fence below it, deterministically, and orphaned all 41 markers on the first run after they were
written. Blank lines are therefore transparent — but a marker separated from its block by a
paragraph does not attach, which keeps the property strict adjacency was protecting: a comment left
behind by a moved block covers nothing, and is reported as an orphan.

### One program per block

A review demonstrated three consequences of compiling a package's blocks together:

- one syntax error suppressed **every** semantic diagnostic in the package, because `tsc` emits
  none when a program has any syntactic error — and the affected blocks were still counted
  "type-checked";
- a `needs=` stub in one section replaced a real module's types with `any` for every other block in
  that package;
- the reported counts moved silently as a side effect of the first.

Per-block isolation removes all three. It is compiled in-process rather than by spawning `tsc`,
because sixty-four spawns is a minute of wall clock.

## Alternatives considered

- **A separate manifest of file + block index** — rejected: indices shift when anyone edits the
  README above them, so the manifest drifts and points at the wrong block.
- **A per-file opt-out** — rejected: it is how a gate stops covering the documents that need it
  most.
- **`satisfies="Type"`, asserting the block's default export** — built, then removed. It was added
  to catch `export default { plugins: [...] }` in a `theo.config.ts` example. Measured, that
  example **works**: `loadConfig` refuses only `null` or a non-object, and `.build()` returns
  `Partial<TheoConfig>`, which a bare `{ plugins }` satisfies. No assertion can separate them
  because there is nothing to separate.

## Consequences

Reported as three numbers, never one: type-checked, parsed only, not set up. One number would hide
the other two, and "how much did you actually check" is the question a gate must not make its
reader compute.

Known and stated rather than hidden: a `partial` block is not type-checked, so a wrong signature
inside one is invisible; a `needs=` stub is `any`, so types flowing from it are unchecked within
that block. Both are declarations a human wrote and a reviewer can disagree with.
