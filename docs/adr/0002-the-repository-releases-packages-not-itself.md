# ADR 0002 — This repository releases packages, not itself

- **Status**: accepted
- **Date**: 2026-08-23
- **Supersedes**: the root `v*` tag convention, which stopped at `v0.3.0` without a decision

## Why this is written down here

`.claude/knowledge-base/adrs/` is the kit's location and is excluded by `.gitignore`, so a decision
recorded there does not survive a plugin reinstall and never reaches a consumer reading the
repository — the same reasoning as ADR 0001.

This one has a second reason: the check that enforces it prints this file's path in its failure
message. A pointer into an ignored directory would resolve to nothing in a fresh clone, which is
precisely how the convention it replaces died.

## Context

Measured 2026-08-23:

```
$ git tag -l 'v*'                              →  v0.1.0  v0.2.0  v0.3.0
$ grep -c '^## \[[0-9]' CHANGELOG.md           →  8
$ git describe --tags --abbrev=0               →  @theokit/auth-github@0.3.0
$ node -p "require('./package.json').version"  →  0.0.0     (private: true)
```

Three tags against eight version headers: **five versions existed only in prose** — 0.4.0, 0.5.0,
0.6.0, 0.6.1, 0.7.0. They were typed by hand in `chore(release)` commits, and the practice ended
when `changesets/action` took over the release. Nobody decided it should end.

The root version never denoted anything. `0.0.0`, private, published nowhere, read by no script.

The deeper fact is not the tags. `changeset version` rewrites **package** changelogs and never
touches the root one, so the root file cannot be kept current by the process that now cuts
releases. On the morning of 2026-08-23 all eleven packages shipped — with tags and GitHub releases
— while **61 entries sat under `[Unreleased]`**. The file said nothing had been released since
0.7.0.

Meanwhile the accurate record already existed: 11 generated package changelogs and 55 package tags.

## Decision

**The releasable units are the packages.** The root `CHANGELOG.md` carries dated sections, not
version headers:

```markdown
## 2026-08-23

Eleven packages cut together: `@theokit/plugin-payments@0.4.0`, `@theokit/auth-github@0.3.0`, …
```

The root `v*` tag is not revived. `git describe` answering a package tag is correct for a
repository whose releasable units are packages.

Historical sections keep their original identifier parenthetically —
`## 2026-08-18 (recorded at the time as 0.4.0)` — so an old reference still lands. The three
versions that **do** have a `v*` tag keep their version header, because for those the identifier
resolves.

## Alternatives considered

- **Revive `v*` tags at each release.** Rejected: the tag would name a version no manifest carries,
  alongside 55 package tags that already record what shipped.
- **Delete the root CHANGELOG, defer to per-package files.** Rejected: those are changeset dumps
  keyed to commit subjects. The root file is the only place the work is written for a consumer
  (Unbreakable Rule 6), and deleting it would lose the one thing it adds.
- **Keep version headers and maintain them by hand.** Rejected on evidence: that is what was being
  done, and it produced five unbacked versions because nothing checked.

## Consequences

`pnpm quality:changelog` gains a release-drift check: it fails when a package tag is newer than the
newest dated section. Tags are the only artefact a release produces without a human, which is why
they are the comparand — the previous convention died silently precisely because nothing checked.

Two floors, stated rather than hidden: the check cannot see a release recorded _badly_, only one
not recorded at all; and the comparison is day-granular, so a release and its record on the same
day always agree.

When no tags are readable — a shallow clone, a tarball — the check reports that it did not run and
passes. It does **not** print its success line in that case. The first version did both at once,
which is the third time a gate in this repository claimed a comparison it had not made.
