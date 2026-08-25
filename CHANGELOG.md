# Changelog

Workspace-level changes for the `theokit-plugins` monorepo. Per-package changes live in each `packages/plugin-*/CHANGELOG.md` (auto-managed by Changesets).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this repo adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The imports-nothing peer rule covers every peer, not only the framework's.** It refused a
  `theokit` or `@theokit/*` peer that nothing imported and ignored `stripe`, `drizzle-orm`, `react`,
  `zod` and the rest. Widened, it found eight such peers across five packages — and every one turned
  out to be correct and already explained somewhere: the ORM install line in two READMEs, a docblock
  saying `plugin-email` deliberately avoids an unconditional `react` import, another saying
  `plugin-forms` reads Zod class names off the constructor. Those are now entries in the triage map,
  so the next undeclared peer is the one that gets refused. `@types/*` is excluded by construction —
  ambient types are never imported by anyone (#166)

- **The manifest gate checks every peer dependency, not only the framework's.** Its three peer
  rules were all scoped to `theokit` and `@theokit/*`, so a third-party peer — `lib0`, `yjs`,
  `react`, `stripe`, `drizzle-orm` — was checked by nothing. It now asserts, for every peer, that
  the version this repository actually builds against satisfies the range the package publishes.
  Comparing against the INSTALLED version is what the previous rule could not do: it compares two
  ranges, and a peer floor sitting above the devDependency's reads as caution rather than as a
  promise of a version that does not exist. Offline by construction — a peer with nothing installed
  is reported as unmeasured rather than counted as a pass (#164)

### Fixed

- **`plugin-payments` no longer claims stripe majors it cannot compile against.** The peer said
  `>=14.0.0` while npm serves 22.5.0. `src/options.ts` types the API version as
  `Stripe.LatestApiVersion` and assigns `'2023-10-16'` to it — stripe 14's literal, and only 14's
  (15 says `2024-04-10`, 22 says `2026-07-29.dahlia`), so the file does not typecheck above 14. On a
  newer SDK a consumer either hit `StripeApiVersionError` at client construction or was silently
  pinned to an API version three years older than their own types described. The supported range is
  unchanged; the manifest now states it at install time rather than leaving it to runtime (#166)

- **`plugin-realtime` no longer asks for a `lib0` version that does not exist.** It declared the
  peer as `^1`; npm's latest `lib0` is `0.2.117` and the whole `1.x` line is prereleases, which a
  caret without a prerelease tag excludes — so the range matched nothing a consumer could install,
  while `yjs` and `y-protocols` both depend on `lib0@^0.2.x`. Nothing imported it: the provider
  loads `yjs` and `y-protocols/awareness.js`, and its own error message already said to install
  those two. It stayed invisible because the devDependency said `^1.0.0-rc.1`, which does match the
  rc line — so the package built here against a version its published peer forbade (#164)

## 2026-08-25 (fifth cut)

Three packages: `@theokit/auth-github@0.5.1`, `@theokit/auth-google@0.5.1`,
`@theokit/auth-magic-link@0.6.1`.

The route examples in all three READMEs named `server/routes/api/auth/<provider>/…`. TheoKit
already serves `server/routes/` under `/api`, so those files answer at
`/api/api/auth/<provider>/…` — a reader who registered `/api/auth/<provider>/callback` with
GitHub or Google got a 404 on the redirect, and the generated typed client carried the same
redundant segment.

Found by building a consumer app against these examples and watching a real OAuth callback fail.

## 2026-08-25 (fourth cut)

<!-- Dated in UTC, which is what `tools/check-changelog-structure.mjs` compares against and what
     the tags carry. This section said 2026-08-24 for a release tagged 00:48 UTC on the 25th — the
     same instant, two calendar days, written from a UTC-3 clock. The tool's own docblock warns
     about exactly that and it happened anyway, which is why the note is here rather than there. -->

Four packages: `@theokit/auth-github@0.5.0`, `@theokit/auth-google@0.5.0`,
`@theokit/auth-magic-link@0.6.0`, `@theokit/plugin-copilot@0.5.0`.

All three auth READMEs opened by importing `defineAuth` — a function that shipped in
`@theokit/sdk` 2.x and is gone from 4.x, the version npm serves. A reader following the
first example imported something that does not exist. The orchestrator is `Auth.create`
and the options are unchanged.

Nothing here caught it because these packages were verified against `@theokit/sdk@^2.18.0`,
two majors behind a consumer's install. The gate that type-checks README examples was
reading a version where the function still existed.

`plugin-copilot` also composes with the two packages it was always supposed to: its agent
contract could not be satisfied by any real agent, and its mirror of the realtime frame had
stopped at four of six variants.

### Changed

- The auth packages and `plugin-copilot` are built, tested and documented against `@theokit/sdk@4.54.0`; the peer floor moves to match, instead of admitting two majors nobody here verifies (#158).

### Fixed

- All three auth READMEs opened by importing `defineAuth`, which shipped in `@theokit/sdk` 2.x and is gone from 4.x — the version npm serves. The orchestrator is `Auth.create`; the options are unchanged (#158).
- `plugin-copilot`'s agent contract could not be satisfied by any agent: it promised an output type no parameter determined, so `@theokit/sdk`'s `Agent` was not assignable while the README invited exactly that wiring. It is now parameterised on the schema, as the SDK is (#158).
- `plugin-copilot` accepts `@theokit/plugin-realtime`'s provider again — the package it declares as a peer. Its mirror of the realtime frame had stopped at four variants while the original grew to six (#158).

## 2026-08-24 (third cut)

Nine packages: `@theokit/auth-github@0.4.0`, `@theokit/auth-google@0.4.0`,
`@theokit/auth-magic-link@0.5.0`, `@theokit/plugin-canvas@0.6.0`,
`@theokit/plugin-copilot@0.4.0`, `@theokit/plugin-db-drizzle@0.5.0`,
`@theokit/plugin-email@0.3.0`, `@theokit/plugin-payments@0.6.0`,
`@theokit/plugin-voice@0.9.0`.

The `route()` examples in four READMEs declared no policy. `theokit@0.50.0` made
`.policy()` mandatory on every route, so a reader copying one of our examples got a build
failure produced by our own documentation. Every example now declares its policy and says
why that policy is the right one.

The peer floor moves to `theokit@>=0.50.1` for the same reason it moved in the tests: these
packages are built, tested and documented against it and against nothing older. A consumer
on `theokit@0.48.x` can still install the previous release.

### Added

- `pnpm check:manifests` now refuses a framework peer range whose ceiling nobody typed — a `^` on a `0.x` version, which pins the MINOR rather than admitting the next release (#151).
- `pnpm quality:route-examples` refuses a README `route()` example that declares no policy, which `theokit@0.50.0+` requires (#155).

### Changed

- These packages are built, tested and documented against `theokit@0.50.1`; the peer floor moves to match, instead of admitting versions nobody here verifies (#155).

### Fixed

- The `route()` examples in four READMEs declared no policy, so a reader copying one got a build failure from `theokit@0.50.0+`, which requires it (#155).

## 2026-08-24 (second cut)

Four packages: `@theokit/auth-github@0.3.1`, `@theokit/auth-google@0.3.1`,
`@theokit/auth-magic-link@0.4.1`, `@theokit/plugin-copilot@0.3.2`.

A patch release carrying one change to what these packages declare, and no change to what they do.

The versions were cut here rather than left for the release workflow, for the reason the earlier
section on this date records: `release.yml` cannot open the "Version Packages" pull request in this
organisation. The previous PR forgot that and shipped its changeset to `main`, where the release run
duly failed at exactly that step — nothing was published and the changeset survived, which is the
recoverable half of the defect B-023 measured.

### Added

- The `@theokit/sdk` peer range on the three auth packages and `plugin-copilot` widened to `>=2.18.0`: they work with the current sdk major, and the old `^2.18.0` produced a peer mismatch pnpm did not warn about in any app scaffolded by `create-theokit` (B-019)

- A `.mailmap` canonicalises author identity, so `git log`, `git blame` and `git shortlog` show one author for commits made under two of the maintainer's email addresses — no commit is rewritten, so tags and published provenance attestations stay valid

## 2026-08-24

Four packages cut together: `@theokit/plugin-realtime@0.2.0`, `@theokit/plugin-forms@0.4.0`,
`@theokit/plugin-payments@0.5.0`, `@theokit/plugin-copilot@0.3.1`.

The release a maintenance run produced: 36 of 37 registry items closed, two of them by measurement
refuting the hypothesis rather than by shipping code. Two defects were reported upstream instead of
worked around (`usetheokit/theokit#429`, `#430`), and the run's own tooling gained seven gates — each
one seen failing before it was trusted.

The versions were cut on `workspace` and promoted through the normal review path rather than by a
"Version Packages" pull request. That is not a shortcut: `release.yml` cannot open that pull request
in this organisation, so leaving the changesets for it would have stopped the release at exactly the
step B-023 documented. Consuming them here means the same bumps get MORE review, not less — two pull
requests instead of one.

### Added

- The Google OAuth success leg — code exchange, PKCE form body, bearer credential, claims mapping — now runs end-to-end across a real socket against a loopback OIDC sidecar, instead of being exercised only by a script nobody can run unattended (B-035 follow-up)

- The dependency-advisory gate is cross-checked against `osv-scanner`, as the deps-audit golden rule always required — a disagreement between the two scanners is reported rather than resolved toward either, and the coverage note stops saying single-sourced (B-034)

- The consumer gate now loads every published entry from a layout holding only that package's declared dependencies, so an entry importing something it never declared fails here instead of in somebody's install — the gate that said it checked peers could not (B-032)

- A live-test suite that tells you to run a `flow:*` script now fails when that script does not exist — `auth-google`'s OAuth success path was exercised by neither CI nor a documented procedure, and nothing detected it (B-031)

- `@theokit/plugin-realtime`: a client subscribing to a Yjs room receives the document's current state instead of an empty one — the second person to open a document no longer waits for somebody to type (B-029)

- `pnpm check:lockfile` fails locally when a `package.json` gains a dependency the lockfile does not carry — the same `ERR_PNPM_OUTDATED_LOCKFILE` CI reports, in about a quarter of a second instead of two minutes into a red pull request (B-027)

- `CONTRIBUTING.md` states which parts of this repository CI does not cover: the `.claude/` maintenance kit is installed tooling, absent from a fresh clone, and checked by no gate here — the product itself is unaffected and fully gated (B-025)

- `@theokit/plugin-payments` exports `STRIPE_DECORATION_KEY` from its `/stripe` subpath, so the key `ctx.stripe` is published under can be imported rather than retyped; the key's value is unchanged and nothing breaks (B-024)

- A `release-dryrun` workflow (`workflow_dispatch`) computes and reports the release this repository would cut — the planned version table and the files a bump would touch — running the same typecheck and test gates the real release runs, and publishing nothing (#16, B-023)
- Backlog B-001 closed: every one of the 11 packages now declares its integration seam, and the conformance suite hands each export to the real `createPluginRunnerFromConfig` / `defineAuth`. Re-verified by mutation: a capability check that `pnpm test` accepts turns the seam suite red (#116, #120)

- `pnpm quality:deps` — a dependency-advisory gate that fails only when a HIGH advisory reaches a package's **runtime** chain, and reports the ones contained in dev chains. Wired into CI, where no audit ran at all before. All nineteen HIGH advisories in this workspace enter through a devDependency, so it is green today — deliberately, because a gate red on arrival gets deleted and then the real one is invisible too (#B-018)
- `pnpm flow:google` in the integration suite — the manual OAuth round trip script `auth-github` already had. The skip message told Google users to run "the flow:\* script for this service"; there was none, so `auth-google`'s success path was exercised by neither CI nor a documented procedure (#B-015)
- Embedded checkout in `@theokit/plugin-payments`: `createCheckout({ uiMode: 'embedded', returnUrl })` returns a `clientSecret` to mount the payment form inside your own page. Proven against real Stripe, not only typed (#B-013)
- `<TheoForm encType="multipart/form-data">` in `@theokit/plugin-forms` converts values to the multipart shape the framework reconstructs, so file uploads work. The README said "No file uploads in v0.1"; the file always reached the action, and what was missing was one schema-guided conversion (#B-012)
- `useYDoc()` in `@theokit/plugin-realtime` returns the room's Yjs document instead of throwing. Pass a stable `ydoc` to `<RoomProvider>`; live edits flow both ways. There is no initial sync yet — a client joining an existing document sees it empty until somebody types. `yjs` stays an optional peer (#B-011)
- `@theokit/plugin-realtime`'s `RoomProvider` takes an optional `sender` port, so presence and broadcasts reach other participants instead of staying local (#B-010)
- `pnpm quality:doc-api` now type-checks the TypeScript blocks of every published README, not just their import names. A block declares what it assumes with a `doc-example` comment (#B-009)
- `pnpm quality:changelog` now fails when a package tag is newer than the newest dated section — a release that shipped without being recorded (#B-008)

### Changed

- A quality gate that examined nothing now fails instead of reporting a pass. Two gates were printing `PASS` for a run that checked zero files or zero packages — one of them printing `0/0 = 0.0% (floor 100%)` and `PASS` on adjacent lines — and every gate now derives its summary from what it actually checked, through one shared helper (B-026)

- **BREAKING:** `CheckoutResult` in `@theokit/plugin-payments` is discriminated by `uiMode`. Narrow on it to read `url` (hosted) or `clientSecret` (embedded). `url` stays required on the hosted branch rather than becoming optional, so the guarantee every existing caller relies on is unchanged — but reading it without narrowing is now a compile error (#B-013)
- `CheckoutInput` makes the invalid URL combination unrepresentable: an embedded call takes `returnUrl`, a hosted one takes `successUrl`/`cancelUrl`. Stripe refuses the two together, so the type refuses first (#B-013)
- The root CHANGELOG uses dated release sections instead of version headers. This repository releases packages, not itself: the root manifest is a private `0.0.0`, and five version headers named a version no tag or manifest carried. Decision in `docs/adr/0002` (#B-008)

## 2026-08-23

Eleven packages cut together: `@theokit/auth-github@0.3.0`, `@theokit/auth-google@0.3.0`,
`@theokit/auth-magic-link@0.4.0`, `@theokit/plugin-canvas@0.5.0`, `@theokit/plugin-copilot@0.3.0`,
`@theokit/plugin-db-drizzle@0.4.0`, `@theokit/plugin-email@0.2.0`, `@theokit/plugin-forms@0.3.0`,
`@theokit/plugin-payments@0.4.0`, `@theokit/plugin-realtime@0.1.4`, `@theokit/plugin-voice@0.8.0`.

### Added

- `pnpm check:manifests` now fails when a package declares a seam and no code block in its README calls that seam's factory (#B-007)
- `pnpm check:manifests` now fails when two packages claim the same request-decoration key — the framework accepts a collision silently and keeps only the last plugin registered (#B-002)
- Seam-conformance registry: every package under `packages/` now declares which TheoKit surface it plugs into, and a test fails when one is missing (#B-001)
- Seam-conformance suite for the plugin packages: `plugin-payments`, `plugin-voice` and `plugin-db-drizzle` are now handed to the real `createPluginRunnerFromConfig` on every pull request (#B-001)
- Seam-conformance suite for the auth packages: `auth-google` is now driven through the real `defineAuth` orchestrator, with OIDC discovery served from loopback so the check needs no network (#B-001)
- The OAuth transaction cookie's `HttpOnly` / `Secure` / `SameSite` attributes are asserted for the first time; nothing in this repository covered them before (#B-001)

- `plugin-realtime`'s React surface has frame-reduction tests: which `joined` frame means "you"
  rather than "somebody else", where a `presence-changed` is routed, and what a `left` with no
  connectionId must not do. It moved from 69.73% to 98.52% statements and 53.12% to 87.5%
  branches (#113)
- `<CopilotProvider />` has tests. `handleFrame` — the whole translation from room frames into
  messages, presence and the error banner — was almost entirely unexecuted at 41.93% statements
  and 9.61% branches. `plugin-copilot`'s React surface is now at 100% and the package went from
  81.55% to 93.59% statements, 66.49% to 89.7% branches. No defect this time: every assertion
  passed on the first run (#113)
- `<CopilotChat />` has tests. It was at 0% coverage in every metric — the whole component, never
  mounted — and is now at 100% lines, statements and functions. Mounting it is what found #114
  (#113)
- **Coverage is measured, and has a floor.** Nothing measured it before: no provider was
  installed and the project's own `coverage.min_percent = 80` sat commented out, so the number
  had never been produced in this repository. Measured on the first run it ranged from 58.82% to
  97.74% — and the lowest, `plugin-forms`, had never mounted either of its components.
  `pnpm coverage` now runs every package through `@vitest/coverage-v8` with an 80% line floor,
  and `ci.yml` runs it beside the unit suite (#109)
- `@theokit/plugin-forms` gains component-level tests: `<TheoField>` was at 8.33% line coverage
  and `<TheoForm>` at 40%, neither had ever been mounted. Line and function coverage for the
  package went from 58.82% / 50% to 100% / 100%, and the new assertions are about accessible
  relationships and submit behaviour rather than markup — which is how the two defects above were
  found
- `Workflow Lint`, a CI gate running actionlint and zizmor over `.github/workflows/` (#74)
- Every published package declares `engines.node`; none of the eleven did (#74)
- `pnpm quality:changelog`, a CI gate that fails when the `[Unreleased]` block declares a category
  twice or out of the Keep a Changelog order (#100)

### Changed

- Framework peer ranges now describe the version each package is built against. `@theokit/sdk`
  was `>=2.18.0` — unbounded — on the four packages that import it, while the published SDK is
  4.53.1 and their devDependency pins `^2.18.0`: a consumer on the current SDK satisfied the peer
  and received code compiled two majors earlier. `plugin-canvas` declared `@theokit/ui: ^1.1.0`
  while building against `^1.3.2`. Both narrowed, and `check:manifests` now compares the floor of
  EVERY framework peer against its devDependency rather than only `theokit`'s (#107, #108)
- The `theokit` peer floor on nine packages is `>=0.48.7`, the version they are built against.
  The declared floors ran from `>=0.1.0-alpha.5` to `>=0.4.0-beta.0` — ranges spanning the
  framework's move to a builder API — while every one of those packages carries `theokit: ^0.48.7`
  as its devDependency. They admitted versions the code does not compile against, and the failure
  would land in a consumer's build pointing at our package. `check:manifests` now fails when a
  peer floor drops below the devDependency the package is built with (#69)
- `@theokit/plugin-forms` declares `zod: ^4.0.0` and is developed against zod 4. It advertised
  `^3.25.0 || ^4.0.0` while its own peer chain forbids zod 3 — `@theokit/react` requires
  `@theokit/sdk@^1.1.0`, which requires `zod@^4.0.0` — and the repository built and tested it
  against `zod@3.25.76`, so the version tested was not a version a consumer could install. This
  does not by itself make `npm install` succeed; the remaining conflict is upstream and is
  measured on #64
- **Breaking:** the minimum supported Node is 22.12.0, was 20.12.0. Node 20 reached end of life,
  and CI had been running 22 all along — so the version tested was never the version declared (#74)
- pnpm pinned to 10.34.1 across the repository, resolved from `packageManager` (#74)
- The npm used by the publish step is pinned to an exact version rather than a range that could
  drift into npm 12, which breaks the release path (#74)

- **Test runs no longer claim every core on the host.** None of the 11 package configs capped `maxWorkers`, so vitest's default applied — `os.availableParallelism()`, one fork per core, each booting a full test environment. This repo's `test` script fans out across packages, so that default is paid once per package _concurrently_: measured on a 12-thread machine, pnpm runs 6 packages at a time, which is 72 CPU-bound forks on 12 cores. The cap now leaves 4 cores free (`Math.max(2, cpus().length - 4)`), which scales with the runner instead of hard-coding one machine's core count. It costs no wall-clock — measured in `theokit-ui`, the full suite ran 73.96s at 4 workers against 74.36s at 12, so the parallelism above the cap was already noise. (usetheokit/theokit-ui#51)

- The four actions in the release workflow are pinned by commit SHA instead of by ref. The job
  publishes as this organization, so a moving ref decides what runs in it. `changesets/action@v1`
  was the sharpest edge: `v1` is not a tag in that repository but a **branch** — the tag lookup
  returns 404 — so any push to it changed the code running with those credentials, with no release
  and no version bump to notice. Each pin carries the version it resolved to, read from the
  action's own tags. Majors are unchanged: this freezes what already runs rather than upgrading it.

### Deprecated

### Removed

- `RoomContextValue.subscribe` in `@theokit/plugin-realtime`, along with the listener set it was
  the only writer to. Nothing called it, and neither the context nor its type is exported, so the
  notify loop ran over an empty set on every frame (#115)

### Fixed

- The three auth packages now document `THEOKIT_OAUTH_TX_SECRET` as **required in production**. Without it, `@theokit/sdk@2.18.0` encrypts the OAuth transaction cookie — which carries `state` and `pkceVerifier` — with a constant published inside the package. These packages cannot fix it (they implement a type contract and never construct the orchestrator); the defect is pinned by a test that goes red when the sdk fixes it (#B-021)
- The auth conformance suite now says why it breaks on an `@theokit/sdk` major bump, instead of failing with a bare `TypeError`. Measured: `defineAuth` is absent in sdk 4, but **no package imports it** — all four take types only, and those types exist in both majors. The packages were never affected; the test was (#B-019)
- `@theokit/plugin-forms` documented a headless tier "usable in any React stack" that cannot be reached: the package has one entry point and it imports `@usetheo/ui` at module scope, so the import fails before any component renders. Three README claims were false, one contradicting the package's own manifest. The behaviour is now documented and pinned by a consumer test (#B-016)
- The auth caveats now say the round trip is blocked by a **session credential**, not by the absence of a browser, and carry the date last measured. A headless browser without a session gets the same redirect to a login screen, so "needs a browser" invited reaching for one and discovering the real cost late (#B-015)
- The AbacatePay readiness caveat listed the refund happy path as uncovered. It was covered by a test in the same commit that added the caveat, so the claim was false from the day it was written — not stale. The remaining two entries now carry the kind of block (provider capability vs structural) and the date last measured (#B-014)
- Yjs frames now carry base64 in both directions in `@theokit/plugin-realtime`. Only the server-to-client half was encoded, so a frame produced by a browser could not survive `JSON.stringify` — the transport the package's own README documents. `dispatchFrame` still accepts raw bytes (#B-028)
- A CRDT frame sent to a room whose descriptor never declared `storage: 'yjs'` is now refused by name. It was silently dropped on a provider without Yjs support, and silently _applied_ on one with it — writing document state into a room that never opted in (#B-011)
- A corrupt Yjs frame no longer ends the whole room subscription in `@theokit/plugin-realtime`'s React provider. One bad payload used to take presence and broadcast down with it, with no error anywhere (#B-011)
- Three documented examples did not compile: `withAgentContext({ userId })` against an `AgentContext` that has no `userId`, two untyped parameters in `auth-google`'s wrapper example, and a React example calling `useState` without importing it (#B-009)
- `@theokit/plugin-copilot`'s README and npm description named `defineCopilot` and never the plugin, so a consumer following them never registered it (#B-007)
- The seam registry is now load-bearing: a package declared as plugging into a seam fails the suite unless a conformance case builds it or names where one lives (#B-001)

- **`<CopilotChat />` showed the user to themselves as another participant.**
  `useCopilotPresence()` filters the local user out only when given its connectionId, and the
  component passed none — while naming the result `otherPresence`. It had no id to pass:
  `CopilotContextValue` never exposed one, though `CopilotProvider` receives `userConnectionId`
  and broadcasts with it, and a consumer's `renderParticipants` inherited the same blind spot.
  The id is now on the context, optional so a hand-built provider keeps working (#114)
- **A release could reach npm without a single test having run on the commit it published.**
  `release.yml` and `ci.yml` trigger on the same event — a push to `main` — and run in parallel
  with nothing linking them, and the release job did `install` + `build` + `changeset publish`
  and no gates. The merge of the "Version Packages" pull request creates a commit neither
  branch's CI had seen, so the publish could win the race against a CI run that was failing on
  it. The release job now typechecks and runs the full suite before publishing (#112)
- `BACKLOG.md` is excluded from Prettier. Its `## Index` block is generated by
  `backlog_index.py --write`, and Prettier pads table columns the generator does not — so
  `--check` reported the index stale after every `pnpm format`, and the two gates could never
  both be green (#111)
- **A `plugin-realtime` client that reconnected disappeared from the room for everyone.** Presence
  is keyed by `connectionId` and `leaveRoom` deletes by that key alone, so when a reloaded tab
  reconnected under the same id, the previous session's late `release()` removed the live
  registration — and the other participants got a `left` frame for somebody who had just joined.
  Measured over a real WebSocket: first session `getPresence` returns `["alice"]`, after a
  reconnect `[]`, unchanged at +400ms. The runtime now records which handle owns each
  `(room, connectionId)` and a superseded release is a no-op (#110)
- **The README's Status section linked a file that was deliberately deleted and counted tests that
  had not been counted in a long time.** `ROADMAP.md` was removed in `6159e6d` ("no longer
  relevant") and the link to it survived, so the published README pointed at a 404. The same
  paragraph claimed "661 tests" where the suites now run 897, and cited an "ecosystem milestone
  M6" and an "M0–M3 Harness" that nothing in this repository defines any more. It now states only
  what is checkable here, and the test count is gone rather than corrected — a hardcoded number
  rots the same way twice
- **The `@theokit/plugin-forms` README documented a form that no screen reader could use.**
  `FormField.Control` clones its direct child to inject `id` / `aria-invalid` /
  `aria-describedby`, and Cookbook 1 put a consumer component in that slot, which swallowed all
  three — the label pointed at an id nothing had (#105). Its `<FormField.Error />` was
  self-closing, and that component renders only its children, so the alert appeared empty and the
  reason the server gave was discarded (#106). Both were invisible to anyone reviewing by sight.
  The cookbook is corrected and both shapes are pinned by tests (#105, #106)
- **A mis-permissioned `.env` made CI green without calling a single provider.** The `.env` load
  had a comment-only `catch {}`, so EACCES, EISDIR and any parse error were all reported as the
  comment's "No local .env is the normal case in CI". A correctly populated but unreadable file
  therefore yielded an empty credential set, every live suite skipped naming a credential that
  was right there, and the run passed — the exact outcome this package exists to prevent. Only
  ENOENT is recoverable now; anything else propagates (#81)
- **`E2E_LIVE=false` turned the paid suites ON.** The switch was `!== '0'`, so every non-empty
  value except the literal `0` opted in: a developer editing `E2E_LIVE=0` to `E2E_LIVE=false` to
  stop live runs started them — real email through Resend, real Stripe and AbacatePay checkouts,
  real OpenAI credit — while the generated `.env.example` header promises "Nothing runs without
  E2E_LIVE=1". It is now equality against that documented value, and an unrecognised value stays
  off rather than being guessed at (#79)
- `@theokit/plugin-forms` built with `tsup src/index.ts --format esm --dts --clean`, and a CLI
  entry argument overrides `tsup.config.ts`, so that config's `entry` was dead. Every sibling
  package runs bare `tsup` and lets the config decide; adding an entry to the config here would
  have been silently ignored. The script now matches its siblings
- `@theokit/plugin-forms` declared `@usetheo/ui` an OPTIONAL peer while its public barrel imports
  it at module scope, so a clean install succeeded and the first `import` threw
  `ERR_MODULE_NOT_FOUND`. The declaration now matches the code. The "headless works peer-free"
  path the flag promised has never existed in any published version — the barrel has re-exported
  `TheoField` since the v0.1.0 scaffold — so the promise is retracted rather than left broken, and
  making it real is tracked as its own API decision (#103)
- **`npm install @theokit/plugin-forms` succeeds.** `@hookform/resolvers` was declared a peer,
  putting it in the consumer's top-level resolution, where npm eagerly satisfies its own optional
  peer `@typeschema/main` — and `@typeschema/zod` pins `zod@^3.23.8` while `@theokit/sdk`
  requires `zod@^4.0.0`. Two transitive chains, mutually exclusive, neither of them this
  repository's. It was never a consumer contract either: `TheoForm` imports `zodResolver` from it
  internally and the consumer never names the package. As a dependency it resolves inside the
  package's own subtree and the conflict does not arise (#64)
- **The peer-without-use gate checked exactly one name.** `checkFrameworkContract` asked whether
  `theokit` was declared and unimported, so any `@theokit/*` peer in the same state was invisible
  to it — seven of them were, across five packages. A peer nobody imports is not inert: it drags
  its own dependency tree into the consumer's resolution, which is how `@theokit/plugin-forms`
  became impossible to install. The gate now covers every framework peer, with per-peer
  exemptions, and the seven decorative peers are gone (#66)
- Clicking "Cancel" on the GitHub consent screen made `pnpm flow:github` sit for two minutes and
  then report "timed out waiting for the consent redirect" — about a redirect that had already
  arrived. The denial redirect carries `?error=access_denied` and no code, which fell into the
  no-code branch: 204, server left listening, timer left running. It now answers the browser,
  closes the server and rejects immediately with the error GitHub named (#98)
- `pnpm flow:stripe-webhook` failed runs in which nothing had gone wrong. Async event types with
  no instance on the account yet — which the script itself describes as arriving
  minutes-to-hours later — were pushed into the same array as triggered events that never
  arrived, and the exit check counted that array against the number of events triggered. On a
  fresh test account where all three triggered events arrived, verified and mapped correctly, the
  run still exited 1 reporting "2 of 3 event types never arrived", counting two that were never
  among the three. They are now reported as a note (#88)
- `pnpm flow:stripe-webhook` reported `NEVER ARRIVED` for two event types it had just verified.
  The handler registrations were a second, hand-written copy of the normalised types `EXPECTED`
  declares, and it held four of the five: `checkout.expired` and `payment.disputed` had no
  handler, so a real delivery with a Stripe-produced signature was normalised correctly, recorded
  nowhere, and reported as unverified after burning the full 120-second window. The registrations
  are now derived from `EXPECTED` (#87)
- The Stripe reconciliation test asserted `amountInCents: 500` and `currency: 'USD'` against a
  fixture whose provisioning instructions say only "create a product with a one-time price". An
  operator following them to the letter got a failure naming the provider, for a requirement
  nobody had written down. It now reads the amount and currency off the price the session was
  built from — which is also the stronger claim: comparing the reported amount to the price tests
  the provider, comparing it to a literal tests the dashboard (#94)
- `LONG_BASE`, a constant the delivered-mail suite explained two of its tests by, produced a
  byte-identical message. The magic-link callback path is absolute, so
  `new URL('/auth/magic-link/callback', base)` discards whatever path the base carried. A
  maintainer shortening it would have believed they were weakening coverage, and one lengthening
  it that they were strengthening it; neither is true. Removed, and the comments now name what
  does produce the fold — a 102-character link against a 76-column quoted-printable line (#102)
- The text-part magic-link test asserted that the delivered link survives recovery without ever
  asserting that it had been folded — the guard its sibling html test carries. A change that
  stopped folding the link would have left it green while its name claimed to cover the fold. It
  now asserts the link is longer than a quoted-printable line, so the fold is necessary rather
  than assumed (#97)
- **The delivered-mail suite was correct only in declaration order.** Six tests shared one
  module-level `delivered` array, and two of them sent nothing — they asserted against whatever
  a describe-level `beforeAll` had left behind. Under `--sequence.shuffle` one failed on a
  mailbox address, pointing at the delivery path rather than the ordering, and the other — whose
  comment calls it a guard for the next test — kept passing against an unrelated message, which
  is a guard that cannot fail. Every test now produces its own delivery (#86)
- The service registry described `exercise` as "the load-bearing field. It is not decoration",
  and nothing branches on it: its only readers are a printed label in the readiness report and a
  comment in the generated `.env.example`. A reader who believed the docblock would assume that
  changing `api-key` to `oauth-redirect` changed what runs, when it changes one printed word. It
  now says what the field does, and names the choice that actually decides — the suite author
  reaching for `describeLive` or `describeManualOAuth` (#96)
- The `auth-github` live suite read `.code` off a variable only assigned inside a `catch`. If
  GitHub ever stopped refusing a deliberately invalid code — the upstream drift that suite's one
  live assertion exists to detect — the catch would not run and the read would throw a
  `TypeError`, reporting a harness crash instead of naming the contract that moved. It now
  asserts the rejection happened before reading off it (#89)
- **The seam suite proved that the auth providers compose with a hand-written shim, not with a
  TheoKit route.** It called `config.handler(ctx)` directly and built `ctx` itself, so it skipped
  every stage the framework runs before a handler and, worse, built a `ctx` the framework never
  builds. Three defects hid behind that: the shim put a body-carrying `Request` on `ctx.request`
  where TheoKit puts a bodyless one, so the magic-link assertion the file called load-bearing
  passed on an accident (#76); the CSRF stage never ran, so a POST route with no `csrf: false`
  read as composable while a real consumer gets 403 before the handler (#78); and the suite saw
  the handler's throw rather than the response, so it could not see that a rejected state answers
  500 with the provider's internal message echoed to the caller (#95). The suite now runs a live
  `node:http` server through TheoKit's own `executeRoute`
- **The assertion guarding the packaging contract's coverage was the inverse of the comment
  beside it.** `toBeGreaterThanOrEqual(11)` passes when a package is added — 12 >= 11 — and fails
  only when one is removed, while the comment promised the opposite: "if a package is added, this
  fails until it is acknowledged". Alongside it, `private: true` dropped a package from all four
  assertions with a bare `continue`, leaving no trace: marking one private removes six tests and
  nothing objected. The count is now exact, and packages outside the contract must be declared in
  a named list rather than disappear (#93)
- **The packaging contract resolved one subpath out of four.** Presence in the tarball and a
  shipped `.d.ts` are static facts that keep holding while `dist/stripe.js` imports a chunk that
  stopped being packed, or pulls a peer nobody declared — so `@theokit/plugin-payments/stripe`
  could throw `ERR_MODULE_NOT_FOUND` for a consumer with all three assertions green. That is the
  exact shape of the incident this file was written for. Every subpath with a runtime entry is
  now imported: seven secondary subpaths across five packages that had never been loaded (#83)
- **The `node:`-prefix packaging check would have reddened every pull request over legal code.**
  It found module specifiers with a regex, and `from` matched inside `Buffer.from('crypto')` —
  the optional-paren group ate the parenthesis and the argument was read as an import. Both
  `crypto` and `os` are builtin names, so `Buffer.from('crypto')` or `Array.from('os')` anywhere
  in a published bundle reported a packaging BLOCKER that was not there. Specifiers now come from
  the TypeScript AST, covering static imports, re-exports and dynamic `import()`, with comments
  and string literals excluded by construction (#84)
- **The generated `.env.example` had drifted and nothing compared it to its generator.** The
  committed copy still carried the pre-rename header, telling a contributor to copy it to
  `e2e/.env` and to regenerate with `pnpm --filter @theokit/plugins-e2e env:example` — a filter
  matching no project in this workspace, so following it looks like a broken generator and ends
  in the hand-edit that generation exists to prevent. Regenerated, and a drift gate now compares
  the committed file against a pure `renderEnvExample()` extracted from the script. The write
  side is guarded to run only when the script is the entry point: importing it used to write the
  file as a side effect, which would have made the comparison agree with itself (#90)
- **Two variables the suites read were declared nowhere, so both CI gates were blind to them.**
  `GROQ_API_KEY` is read by the voice suite and lived only in prose inside that service's
  `caveat`, plus a hand-appended block in the `.env.example` generator — the drift that
  generator's own docblock forbids. The registry had no slot for it: the model had required
  credentials and targets, and this is neither, so `ServiceSpec` gained `optionalCredentials`.
  `E2E_LIVE` is the master switch and belongs to no service; deleting its three mappings from
  `integration.yml` made the entire nightly live run skip and still exit 0, a green tick over
  zero provider calls. It is now a named constant with its own gate. A third gate closes the
  class rather than the two instances: every variable any suite reads through `required('NAME')`
  must be declared in the registry (#80)
- **A suite that narrowed its credentials with `requires` lost the rail that says where it is
  safe to act.** The two options answer different questions — `requires` narrows which
  credentials a contract needs, `sends` declares that the suite writes or spends and so makes the
  spec's target variables mandatory — and they were one branch, so passing the first dropped the
  second. All three voice suites narrow with `requires` and spend real money, so
  `VOICE_TEST_TTS_VOICE` was never checked: the suite fell back to a default voice and billed
  OpenAI while the readiness report in the same run printed that variable as missing. The
  decision is now a pure function, `missingForSuite`, with the environment reader injected so it
  can be tested without one (#82)
- **A hardcoded credential in the workflow block that runs the paid suites passed the gate meant
  to stop exactly that.** `integration.yml` maps every registry variable twice — once for the
  readiness report, once for the live suites — and the check read `.find()`, the first match. A
  literal in the second block left it green while the value would land in the public git history.
  The sibling check, which asserts every registry variable is mapped at all, settled for a
  substring, so a mapping that had been commented out still counted. Both now match a YAML key
  anchored to the start of a non-comment line, and the literal check reports every occurrence with
  its line number (#85)
- The assertion that `ci.yml` invokes the credential-free suites was `toContain('integration:offline')`
  — satisfied by the comment three lines above the step, the one explaining that the assertion
  exists. Deleting the step left the gate green and every credential-free suite would have stopped
  running on pull requests. It now matches a `run:` line (#91)
- The stranded-suite walk descended exactly one directory level while vitest's include glob is
  `tests/**` at any depth, so a credential-free suite three directories down ran only in the
  nightly and the gate reported nothing — the gate's blind spot having the same shape as the
  defect it exists to report. The walk is now recursive (#92)
- **The gate that finds stranded test suites was satisfied by prose.** It decided whether a suite
  needs a credential by regexing the raw source for `required(` and `describeLive(`, comments
  included — so a file that merely _described_ the convention was read as credential-bound and
  dropped out of the walk, leaving the gate to report an empty list, which reads exactly like
  coverage. The classification is now structural, from the TypeScript AST: it asks whether the
  file _calls_ one of those helpers, resolving renamed and namespace imports, so comments, JSDoc
  and string literals are excluded by construction rather than by another pattern. Verified in
  both directions against a probe suite: the old detector classified it credential-bound and went
  green; the new one names it as stranded (#99)
- **Every CI-wiring gate in this repository ran only in the 04:00 nightly.** `readiness.test.ts`
  holds the assertions that the registry reaches CI — that each variable is mapped into the
  workflow, that each mapping is a secret reference and not a literal, that no test directory
  lacks a registry entry, and that every credential-free suite runs on every PR. It was selected
  by neither command `ci.yml` invokes (`vitest run tests/consumer .offline.test.ts` matches
  neither filter), so a variable added to the registry with no workflow mapping went green on the
  pull request and surfaced to whoever read the nightly. Renamed to `readiness.offline.test.ts`,
  which is the convention the file itself defines and had exempted itself from (#77)
- The `[Unreleased]` block declared `Added`, `Changed` and `Security` twice each, leaving two
  `Changed` entries fourteen lines away from the other three. The release bump is derived from
  those sections, and the rule that derives it assumes each names one place in the file — so the
  entry marked `**Breaking:**` was reachable or not depending on which of the two `Changed`
  headings an extractor happened to match. Merged into one canonical series, every entry kept (#100)

### Security

- A `workflow_dispatch` input reached the shell as text spliced into a command line, in the step
  holding every service credential. It is now passed as an environment variable (#74)
- Every GitHub Action is pinned to a commit SHA rather than a movable tag (#74)

## 2026-08-21 (recorded at the time as 0.7.0)

Derivado por `cycle-release.md`: `Added` não-vazio — **minor**. `Removed` também não é vazio,
o que a regra lê como major; aqui isso significaria `1.0.0`, e três coisas dizem que não é.
Em `0.x` o slot de breaking é o minor, é o que os releases `0.2.0` e `0.4.0` fizeram com
`Removed` não-vazio, e uma alegação de `1.0.0` é barrada por `dogfood-golden-rule.md` — não
existe manifest de dogfood neste repositório, então não há evidência de uso sustentado que a
sustente.

### Added

- `@theokit/auth-github`, `@theokit/auth-google` and `@theokit/auth-magic-link` accept a Web `Request` wherever they accepted Node's `IncomingMessage`, so the three of them can be wired into a TheoKit route for the first time. The session is created with `createSessionManagerWeb` from `theokit/server/auth`, keeping the whole flow on Web shapes; the Node-shaped `defineAuth` orchestrator is unchanged (#68)

- Three documentation gates run on every pull request (`pnpm quality:docs`): `check-doc-api-drift.mjs` compiles every `import { … }` in the versioned Markdown and asks the compiler whether the names exist; `check-orphan-docblocks.mjs` finds docblocks stranded above another docblock; `check-doc-coverage.mjs` measures how much of the published surface an editor can actually show, read from the emitted `.d.ts` rather than from source, with a ratchet floor (#67)
- `@theokit/plugin-copilot` is now a real TheoKit plugin: `copilot()` returns something `theo.config.ts` accepts, publishing read-only spend and copilot data on `ctx.copilot` (#62)

### Changed

- The framework usage examples in eight READMEs and `CONTRIBUTING.md` are written against the API `theokit@0.48` actually exports, and each one was verified by compiling it. `defineConfig`/`defineTheoConfig` → `config().set({…}).build()`, `definePlugin` → `plugin(name)…build()`, `defineAction` → `action().input(schema).handler(fn).build()`, `defineAgentTool` → `tool(name)…build()`, `useAgentStream` → `useAgent`. Ten documented names existed in none of that version's 24 export subpaths (#67)
- `@theokit/auth-google` and `@theokit/auth-magic-link` document the HTTP wiring on a Node server, which is the only shape that compiles: the auth orchestrator takes `IncomingMessage`/`ServerResponse` and TheoKit's route handler hands a Web `Request` (#68)
- Every published export of the plugin packages now carries documentation an editor can show; measured coverage went from 63.4% to 100% (356 of 356), and `@theokit/auth-github` and `@theokit/auth-google` went from showing nothing at all (#67)
- `@theokit/plugin-canvas` README no longer tells the reader to import `createArtifactBus` from the package root — it is exported from `@theokit/plugin-canvas/server`, so the documented example did not compile (#67)
- `@theokit/plugin-payments` "Migrating from 0.2.x" no longer moves `payments` to the `/stripe` subpath, which does not export it. The prose two lines above already said only Stripe exports moved; the example contradicted it (#67)
- **BREAKING** `@theokit/plugin-copilot` spend limits are enforced by the SDK's budget engine instead of a local tracker. `monthlyUsd` is now a rolling 30-day window rather than a calendar month; `perRoom.limits` accepts the SDK's own windows (`1h`/`1d`/`1w`/`30d`/`365d`) where the exact boundary matters (#62)
- `@theokit/plugin-copilot` reports in-flight spend separately from committed spend in `getUsage`, so a meter can tell money promised from money charged (#62)

### Deprecated

### Removed

- `@theokit/plugin-forms` no longer declares `theokit` and `@theokit/ui` as peer dependencies — neither was imported, and the first made the package impossible to install even with `zod@4` pinned (#64)

- `@theokit/plugin-copilot` `BudgetBridge.charge()` — fire-and-forget charging that bypassed the reservation accounting (#62)

### Fixed

- `@theokit/plugin-forms` can now be installed with npm by naming `zod@^4`. The default `npm install` still fails on a zod major split outside this package's control; the README states the exact cause and the one-flag fix (#64)

- `@theokit/plugin-copilot` charged every invocation at its estimate instead of its real cost, so a spend ceiling never moved no matter how much an agent spent. Cost is now priced from the tokens the SDK reports (#61)
- `@theokit/plugin-copilot` typed a streaming `partial` chunk as the complete object, promising consumers fields the stream had not produced yet (#62)

### Security

## 2026-08-19 (recorded at the time as 0.6.1)

Derivado por `cycle-release.md`: só entradas em `Fixed` — **patch**.

### Added

### Changed

### Deprecated

### Removed

### Fixed

- **`plugin-forms`: `applyActionErrorsToForm(form.setError, …)` voltou a compilar (#54).** O uso que a própria documentação do adapter descreve não passava no TypeScript: `SetErrorCallback` declarava `name: string`, o `setError` do react-hook-form aceita uma união estreita dos caminhos do formulário, e por **contravariância de parâmetro** a função mais estreita não é atribuível onde se espera a mais larga. Funcionava em runtime — o teste de integração prova o round-trip inteiro —, só os tipos se recusavam a compor, que é o pior lugar para uma biblioteca de formulário ser rigorosa à toa.

  `SetErrorCallback` virou genérico sobre o nome, com default `string`, então **todo uso existente continua válido** (verificado compilando o formato antigo). O cast que a ponte não tem como evitar — as chaves chegam do servidor como string em runtime, e o `TName` é o conjunto que o formulário conhece em tempo de compilação — passou a viver **dentro do plugin, uma vez**, em vez de em cada chamada. Medido para o caso que o cast admite: `setError` com caminho que o formulário não tem **não lança e não é descartado**; o RHF o guarda aninhado, então uma chave estranha vira erro que nenhum campo renderiza e nada mais quebra.

  A alternativa de importar `UseFormSetError` do react-hook-form foi descartada: abandonaria a decisão do ADR D3 de manter o adapter livre de peer-dep no nível de tipo.

### Security

## 2026-08-18 (recorded at the time as 0.6.0)

Derivado por `cycle-release.md`: `Removed` vazio, nenhuma entrada de `Changed` começando com
**BREAKING**, `Added` não-vazio — **minor**, sem a tensão que 0.4.0 e 0.5.0 tiveram.

### Added

- **`plugin-forms`: o erro do servidor passou a ser seguido até o campo que o produziu.** O teste de integração existente já fazia a metade do transporte bem — `http.createServer` real, fetch real — mas chamava o adapter com `vi.fn()` como `setError`, então provava que ele _invoca um callback_, não que um formulário real exibe algo. O novo teste fecha o laço: 422 real → fetch → `applyActionErrorsToForm` → **react-hook-form real** → `useTheoField(nome).isInvalid`. Cobre a chave aninhada `address.city`, que é onde o adapter aposta numa afirmação sobre biblioteca de terceiros (_"RHF accepts flat dot-notation keys directly"_) que ninguém tinha verificado, a convenção `''` → `root`, e a recuperação: editar o campo limpa o erro do servidor sem limpar os outros.

- **`plugin-canvas`: o store SQLite passou a ser exercitado contra um banco de verdade.** A cobertura existente eram 5 casos, todos de validação de nome de tabela, todos contra `{} as db` — um objeto vazio com cast para o tipo do driver. Nenhum SQL era executado, `autoMigrate` nunca rodava, e insert/get/getVersions/list/nextVersion/delete contra SQL real eram inteiramente não verificados: o pacote publicava um store SQLite sem nunca ter rodado um. O novo teste é de **conformidade** — a mesma sequência passa pelos dois stores e eles têm que observar a mesma coisa, o que torna o store em memória a especificação executável que ele já era na prática. Inclui o caminho de linha corrompida fora de banda, que o próprio store documenta e ninguém testava, e prova que um nome de tabela customizado é honrado (os 5 casos antigos provavam só que um nome inválido é recusado).

### Changed

- **`pnpm typecheck` passou a olhar arquivos `.tsx`.** O `include` da raiz cobria `**/*.ts` e não `.tsx`, então **13 arquivos de teste React nunca foram verificados** — e um deles já tinha erro, de um commit anterior. Alargar expôs 22 erros: assinatura do mock de `fetch` mais estreita que a função real (o que fazia a análise de fluxo estreitar leituras posteriores para `never`), `HTMLElement` onde faltava estreitar para `HTMLInputElement`, e variância de genérico em `UseFormReturn`. Todos corrigidos, nenhum silenciado com `any`. Reverter o alargamento deixaria os 13 arquivos cegos para sempre, que é a mesma cegueira dos gates consertados acima.

### Deprecated

### Removed

### Fixed

- **`plugin-realtime`: uma edição Yjs nunca chegava aos outros clientes (#53).** `applyYjsUpdate` aplicava os bytes no `Y.Doc` do servidor e não notificava subscriber nenhum — nenhum observer no doc, nenhum `fanout` de `yjs-update`. Numa sala `storage: 'yjs'` a edição colaborativa parecia funcionar para quem digitava e não sincronizava com ninguém. `applyYjsAwareness` tinha a mesma omissão, então cursores remotos nunca apareciam. Efeito colateral: o ramo base64 do `frameToOutput` era código morto, porque nada produzia o frame que ele convertia.

  Achado escrevendo o teste de integração do B-003 — os 57 testes existentes paravam antes do fio, e dois deles declaram `(in-process)` no próprio nome.

### Security

## 2026-08-18 (recorded at the time as 0.5.0)

**Por que 0.5.0 e não 1.0.0.** A regra mecânica de `cycle-release.md` derivaria `major`: há
entradas em `Changed` começando com **BREAKING**. Mas `1.0.0` é uma afirmação sobre maturidade,
e `rules/public-copy.md § 3` proíbe `production-ready` sem evidência medida de uso sustentado
em produção — que o `dogfood-golden-rule.md` também exige e que não existe. O breaking está
contido em `@theokit/plugin-db-drizzle`, ele mesmo em 0.x, onde `^0.2.0` **não** resolve para
`0.3.0`: quem depende do range antigo não recebe a mudança sem agir. Mesmo raciocínio aplicado
em 0.4.0.

### Added

- **`db generate`, `db migrate`, `db studio`, `db check` e `db reset` passaram a funcionar (#48).** Antes, cinco dos seis verbos que o plugin declarava como passthrough do `drizzle-kit` montavam uma linha de comando que o binário **recusa** — `theokit db generate` respondia `Please provide required params: dialect`, e `theokit db reset` invocava um subcomando que não existe em nenhuma versão do drizzle-kit. Só `db push` funcionava. Cada verbo agora recebe exatamente os flags que o `drizzle-kit@0.31.10` aceita, medidos contra o binário.

- **`renderDrizzleConfig(options)` exportado.** `migrate` e `studio` aceitam **só** `--config`, então o plugin sintetiza o `drizzle.config.ts` a partir das opções que você já passou em `drizzleDb(...)` — a conexão continua declarada num único lugar. O arquivo é escrito em `configPath` (default `./.theokit/drizzle.config.ts`) e reescrito a cada execução: **adicione `.theokit/` ao seu `.gitignore`**.

- **Opção `resetScript`.** `db reset` roda o seu script, como `db seed` já fazia. Sem script configurado, o erro nomeia a configuração que falta em vez de nomear o drizzle-kit.

- **A costura `@theokit/plugin-email` ↔ `@theokit/auth-magic-link` passou a ser exercitada de verdade.** O `sendMagicLink()` existe para satisfazer a porta `sendEmail` que o `auth-magic-link` declara, e os dois pacotes tinham boa cobertura — cada um contra a **própria ideia** do outro. A única asserção de compatibilidade dizia "returns a SendMagicLinkFn-compatible async function", verificada dentro do pacote de e-mail contra o tipo dele mesmo; nada nunca entregou o adaptador real à porta real. Agora quatro asserções percorrem o caminho inteiro: `startSignIn` cunha e persiste o token, o template renderiza, a URL é recuperada do HTML como um cliente de e-mail faria, e `handleCallback` a aceita. Cobre também o corpo em texto puro, uma base de callback que já tem query string (onde o `&` vira `&amp;` no href), e uso único ponta a ponta.

- **O e-mail de magic-link passou a ser enviado de verdade no e2e.** A suíte live de e-mail enviava um `<p>marker</p>` montado à mão — o template que o usuário realmente recebe nunca tinha passado pela API do Resend. `e2e/tests/email/magic-link-live.test.ts` agora percorre `magicLink()` → `sendMagicLink()` → `ResendProvider` → HTTP real, e afirma o UUID de message-id que o Resend devolve **antes** de alegar qualquer coisa sobre o conteúdo. Verificado por mutação: chave inválida derruba os três com `EmailSendError … statusCode: 401`.

  **O que ele não prova, e está escrito no cabeçalho do arquivo:** ninguém leu esse e-mail de uma caixa de entrada. `EMAIL_TEST_RECIPIENT` é o endereço de sandbox `resend.dev`, que aceita e descarta, e a chave é restrita a envio (`GET /emails` → `401 restricted_api_key`). O link afirmado é o que **nós** transmitimos, recuperado do HTML de saída. Essa última perna segue aberta como B-004.

- **`db studio` abre (#49).** Com os argumentos já corrigidos por #48, o verbo ainda morria ao ler o config: o `drizzle-kit@0.31.10` importa `drizzle-orm/singlestore-core`, subpath que só existe a partir do `drizzle-orm@0.37.0` — e o peer do pacote aceitava `>=0.36.0`. O piso subiu para `>=0.37.0`. Medido: falha em 0.36.4, sobe em 0.45.2 (`Drizzle Studio is up and running`), honrando o `studioHost`/`studioPort` que você passar.

- **E o link passou a ser lido de uma mensagem que chegou (#B-004).** `e2e/tests/email/magic-link-delivered.test.ts` sobe um servidor SMTP real, envia por TCP com MIME de verdade, faz o parse do que **chegou** e extrai o link do corpo recebido — que então tem que logar o usuário. Não precisa de credencial nenhuma: verificado passando com `env -i`.

  **Achou um modo de falha real.** Quoted-printable quebra linha na coluna 76, e uma URL de magic-link é mais longa que isso. Medido no fio: `…token=3DFwjS2sHm5q2XCdvqB6cIvbhtiOOYL1BvU1=` na coluna 76, com o resto na linha seguinte. Todo teste de transporte JSON deste repo fica verde apesar disso, e quem usar SMTP — a escolha óbvia para self-hosting — passa por esse caminho. O teste afirma que a quebra **ocorreu** antes de afirmar a recuperação, então não pode passar sem exercitar o caso; extrair dos bytes crus derruba 3 das 6 asserções.

### Changed

- **Os testes e2e sem credencial passaram a rodar em toda PR, não só de madrugada.** O `magic-link-delivered` foi escrito em `e2e/tests/email/`, onde só o job noturno chega — uma PR passava verde por cima dele, e a quebra seria encontrada por quem lesse a execução das 04:00. `pnpm e2e:offline` roda tudo que não precisa de credencial (`tests/consumer/` mais qualquer `*.offline.test.ts`) e entrou no `ci.yml`. A convenção é mecânica de propósito: `readiness.test.ts` falha quando uma suíte sem credencial é escrita fora dela, e falha também se o `ci.yml` parar de invocar o comando.
- **`pnpm lint` e `pnpm typecheck` passaram a cobrir a suíte de integração.** O `tsconfig.json` da raiz incluía apenas `packages/*/src` e `packages/*/tests`, e o padrão do lint apontava só para `packages/**` — então `integration/` era verificado por ninguém na CI, e o script `typecheck` que o próprio pacote declara nunca era invocado. Ao alargar os dois, apareceram **9 erros de lint** que nunca tinham sido vistos.

- **`check:cycles` deixou de baixar o `madge` da rede a cada execução.** Era `npx --yes madge`, que busca a última versão em toda run de CI — um gate que instala ferramenta não-fixada da internet é problema de reproduzibilidade e de cadeia de suprimentos ao mesmo tempo. Agora é devDependency (`^8`), presa no lockfile.

- **BREAKING (`@theokit/plugin-db-drizzle`) — os argumentos que cada verbo emite mudaram (#48).** Quem consome `buildDbCommands()` diretamente e depende da forma antiga precisa reler: `--schema` sai de `migrate`/`studio`/`check`, `--dialect` **entra** em `generate` (o drizzle-kit o exige lá), `--url` fica só em `push`, e `--out` passa a valer também para `check`. `DbCommand.kind` ganhou um terceiro valor, `'drizzle-kit-with-config'`: quem executa esses comandos **deve** escrever `renderDrizzleConfig(opts)` em `opts.configPath` antes do spawn, senão `--config` aponta para nada. `reset` deixou de ser `'drizzle-kit'` e passou a `'user-script'`.

- **A pasta `e2e/` virou `integration/`, porque era isso que ela sempre foi.** Medido contra `rules/testing.md § 2`: sete das dez suítes são clientes contra APIs reais (a definição literal de integração), uma é nosso código contra transporte SMTP real, uma é relatório de prontidão que não testa comportamento de produto, e só o `tests/consumer/` tem alguma pretensão a E2E — para biblioteca, instalar-e-importar é o fluxo do usuário. Ele ficou dentro, com o motivo escrito, em vez de virar pasta de um.

  Isso não é arrumação: "e2e passou" lê como afirmação mais forte que "integração passou", e o nome é a primeira coisa que se lê. Superestimar no nome da pasta é o mesmo defeito que superestimar num relatório.

  **Comandos renomeados:** `pnpm e2e` → `pnpm integration`, e `e2e:consumer` / `e2e:readiness` / `e2e:offline` → `integration:*`. O workflow `e2e.yml` virou `integration.yml`. **Não** renomeados de propósito: o `environment: e2e` (é GitHub Environment declarado nas settings — renomear só um lado quebra o job) e os valores `theokit_e2e_probe` / `theokit-e2e-hmac-probe-fixture` nas fixtures do `plugin-payments`, que são bytes capturados de uma entrega real e cuja alteração invalidaria a assinatura HMAC.

- **BREAKING (`@theokit/plugin-db-drizzle`) — o peer `drizzle-orm` passou a exigir `>=0.37.0` (#49).** O intervalo anterior (`>=0.36.0`) admitia versões em que `db studio` não abre, então nunca foi um intervalo válido para o verbo. Projetos em `drizzle-orm@0.36.x` precisam subir. Deliberadamente NÃO mexemos no peer do `plugin-payments`, que também declara `>=0.36.0`: ele não dirige o drizzle-kit, e não há medição que justifique apertá-lo.

### Deprecated

### Removed

### Fixed

- **Três jobs da CI rodavam antes do build, e nenhum podia passar num checkout limpo.** `lint`, `typecheck` e `test` faziam `install` e iam direto ao trabalho, mas os imports entre pacotes do workspace resolvem pelo `exports` de cada um, que aponta para `dist/`. Na minha máquina passava por causa de um `dist/` remanescente; na CI a mesma coisa falhava com `Failed to resolve entry for package "@theokit/auth-magic-link"` e uma parede de `type that could not be resolved`. O `pnpm build` passou a rodar antes dos três, e no job de typecheck ele **subiu** para antes do `typecheck` em vez de ficar depois. Reproduzido localmente apagando os 11 `dist/` antes de confirmar o fix — sem isso eu não teria como saber se consertei.

- **`pnpm lint` estava vermelho e nada apontava.** Quatro dos nove erros eram do `magic-link-seam.test.ts`, escrito nesta mesma sequência de trabalho: o commit que o trouxe rodou testes e typecheck, e não rodou o lint. Os outros cinco eram meus também, nos dois arquivos de magic-link em `integration/`. Corrigidos — geradores `async` sem `await`, casts `as string` sobre um campo já tipado `string`, e um spread de `any` vindo de `Array.isArray` sobre `readonly string[]`.

- **Um timeout na suíte de integração podia reportar `[object Object]`.** `integration/src/harness.ts` fazia `String(last)` sobre um erro capturado; um objeto lançado sem `toString` próprio virava `[object Object]`, transformando o relatório de timeout em beco sem saída. Passa a ler `.message` quando existe e a serializar o resto.

- **Os testes do `plugin-db-drizzle` conferiam os argumentos contra a nossa própria expectativa, nunca contra o drizzle-kit (#48).** Seis asserções afirmavam a forma errada e passavam verdes enquanto o CLI estava quebrado — a mesma classe de defeito de #43, um teste que confirma a fabricação em vez de pegá-la. Foram reescritas contra a gramática medida, e `tests/integration/drizzle-kit-grammar.test.ts` passou a **executar o drizzle-kit real** por verbo, além de provar num sqlite de verdade que `generate` escreve o migration e `migrate` cria a tabela. O antigo `tests/integration/lifecycle.test.ts` prometia "drizzle-kit-compatible args" sem nunca consultar o drizzle-kit; o nome foi corrigido para o que ele mede.

### Security

## 2026-08-18 (recorded at the time as 0.4.0)

### Added

- **A contradição do HMAC da AbacatePay resolvida por entrega real, e um canal de secret que não está documentado (#44).** Um túnel público (`npx localtunnel`) mais `POST /webhooks/create` permitiram receber um `transparent.completed` de verdade e comparar o `X-Webhook-Signature` **que eles enviaram** contra as duas chaves candidatas. Resultado: bate com `base64(HMAC-SHA256(rawBody, CONSTANTE_PUBLICADA))`, e **não** com o secret do lojista, em base64 nem em hex. Ou seja, a assinatura é computada com uma chave que qualquer pessoa pode ler nos docs deles: prova que o corpo não foi alterado em trânsito e **não** que a AbacatePay enviou. É por isso que checá-la continua opt-in — ligar por default adicionaria uma verificação que **parece** autenticação e não é. (abacatepay-live-2026-08)

  O achado que muda a segurança: o secret por-lojista chega **também num header `x-webhook-secret`**, não documentado. O provider passou a preferi-lo à query string — secret em URL vai para log de proxy, histórico de browser e Referer, e query string é a parte da requisição que as pessoas colam em ticket. `verifyWebhook` aceita header, ou URL, ou os dois, e recusa quando nenhum traz o secret; antes exigia a URL.

  A captura virou **fixture de regressão offline** (`tests/abacatepay-real-delivery.test.ts`, 5 asserções, sem credencial): a medição aconteceu uma vez e agora roda em todo push. Uma delas afirma que a assinatura **não** bate sob o secret do lojista — se a AbacatePay mudar para assinar com ele, o teste fica vermelho e avisa que o default precisa ser revisto, em vez de a mudança passar em silêncio.

  Dois detalhes que os docs não mencionam e a medição pegou: `POST /webhooks/create` exige `secret` com **≥ 32 caracteres** ("Expected string length greater or equal to 32"), e `POST /webhooks/delete` exige permissão além de "Leitura e escrita" — com escopo de leitura e escrita responde "Insufficient permissions", então o webhook do probe foi removido pelo dashboard e a remoção confirmada pela API.

- **Suíte live da AbacatePay contra a API real em sandbox, e ela refutou a documentação três vezes (#41).** Doze asserções: checkout hospedado, PIX inline com BR Code pagável, reconciliação de status nos dois tipos de recurso, estorno integral **relido da API** para confirmar `refunded`, e as recusas tipadas. Até aqui o provider era escrito a partir dos docs publicados e coberto só contra `fetch` falso — o README dizia isso num bloco de aviso, que saiu. Guard de sandbox espelhando o do Stripe: chave que não começa com `abc_dev_` é tratada como **não configurada**, e todo recurso criado volta com `devMode: true`, que é confirmação independente do prefixo. (abacatepay-live-2026-08)

  O `POST /transparents/simulate-payment` de devMode é o equivalente do `pm_card_visa`: leva a cobrança de `PENDING` a `PAID` sem browser, e é o que torna o estorno verificável de verdade. O `id` dele viaja na **query string** — no corpo, a API responde `Expected property 'id' to be string but found: undefined`, e os docs não dizem onde.

- **A perna de ENTRADA do webhook do Stripe, que a suíte não cobria e não pode cobrir.** As treze asserções ao vivo são todas de saída. O caminho de webhook é o outro sentido, e a cobertura parecia completa exatamente onde faltava: `webhook-crypto.test.ts` assina os payloads com `generateTestHeaderString` — SDK do próprio Stripe, HMAC genuíno — mas **os bytes nascem no nosso processo**. Isso prova que a nossa fiação repassa corpo cru e header sem mutilar; não prova que o que a infraestrutura do Stripe transmite é o que sabemos verificar. `pnpm flow:stripe-webhook` fecha: `stripe listen` abre o túnel, `stripe trigger` faz o Stripe **criar um evento real na conta**, e ele entrega — corpo e `stripe-signature` produzidos por eles. Quem recebe é o plugin shipado, via `payments({ providers }).handleWebhook`. Modo de teste é imposto e não presumido: a config do CLI numa máquina de dev pode ter chave `rk_live_`, então `--api-key` vem explicitamente de `STRIPE_SECRET_KEY` e é recusada se não começar com `sk_test_`. (payments-multi-provider-2026-08)

  **O `EVENT_MAP` passou a ser verificado contra eventos reais, em três níveis que o relatório mantém separados** — porque juntá-los seria transformar duas incertezas numa alegação. Entrega ao vivo (assinatura **e** mapeamento): `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`. Buscados da conta (só o mapeamento, contra um nome que o Stripe escolheu; evento buscado nunca teve assinatura): `checkout.session.expired`, `charge.dispute.created` — medido, o Stripe **emite** os dois, três de cada na conta, só que minutos a horas depois, no relógio dele. E dois que **nada aqui verifica**: `checkout.session.async_payment_succeeded` e `..._failed`, com **zero** ocorrências na conta depois do trigger, porque exigem método de liquidação diferida efetivamente concluído por um cliente. Cinco de sete contra evento real, e os outros dois nomeados em vez de omitidos.

  Isso fecha por outra rota a checagem que eu havia declarado impossível: `/v1/events?types[]=` aceita nome de evento fabricado com HTTP 200 e portanto não confirma nada; um evento que o Stripe realmente emitiu, carregando o nome que mapeamos, confirma.

- **Guard contra suíte dark no CI: toda variável do registry precisa estar mapeada no workflow.** A falha que ele previne foi cometida por quem escreveu o teste, no mesmo dia: `STRIPE_TEST_RECURRING_PRICE_ID` entrou no registry e no `.env` local, e em nenhum dos dois lugares que importam — nem no `e2e.yml`, nem nos secrets do repositório. Localmente a suíte rodava; no ciclo noturno ela skiparia para sempre, imprimindo o nome da variável como ausente ao lado de um tique verde. Variável fora do workflow é suíte **apagada no CI e acesa na máquina do autor** — a forma mais convincente de acreditar numa cobertura que não existe. Um segundo teste confere que cada variável mapeada aponta para `secrets.`, e não para um literal, que seria credencial no histórico público. Verificado nos dois sentidos: removendo o mapeamento, o guard nomeia exatamente a variável que falta. (e2e-2026-08)

- **O plugin também é multi-provider, não só os tipos.** `payments({ providers })` no import de topo guarda os gateways, um store de idempotência e um registry, então uma rota de webhook vira `plugin.handleWebhook(gateway, request)`. Até aqui o contrato conhecia vários gateways e a coisa que quem consome de fato coloca no `theo.config.ts` conhecia exatamente um — o factory do `/stripe`, que devolve `getStripeClient()`. Os providers são chaveados pelo nome sob o qual a aplicação os roteia, **não** por `provider.name`: duas contas Stripe é forma real (marketplace, entidades jurídicas distintas) e derivar a chave do provider colapsaria as duas em silêncio. Nenhuma rota é registrada automaticamente — plugin que reivindica `/api/payments/webhook` colide com a aplicação que já tinha uma. O factory de gateway único virou `stripePayments()`: dois `payments` em dois subpaths é armadilha, e o que se deve pegar por padrão é o multi-provider. Ele mantém razão de existir, porque casa com `defineStripeWebhook`, que estreita `Stripe.Event` de um jeito que o contrato neutro não expressa. (payments-multi-provider-2026-08)

  Cinco testes novos rodam o caminho de webhook contra a **criptografia real** de assinatura do Stripe — `generateTestHeaderString` produzindo um `t=…,v1=…` genuíno, verificado pelo `constructEvent` intocado — cobrindo corpo adulterado, secret errado e timestamp velho. Todos os outros testes desse caminho mockam o `constructEvent`, ou seja, nenhum deles jamais rodou o HMAC e nenhum poderia pegar a nossa fiação mutilando o corpo cru. Foram escritos no pacote e2e e **tirados de lá**: não fazem chamada de rede, e pôr portão de credencial em asserção que não precisa de credencial troca feedback em todo push por feedback uma vez por noite.

- **`@theokit/plugin-payments` cobre o ciclo de vida inteiro, não só o começo dele.** Um plugin de pagamento que só cria checkout obriga quem consome a contornar o contrato e falar com o SDK do gateway justamente nas partes que tocam dinheiro depois da venda. Entraram no contrato base: **`retrieveCheckout(reference)`**, porque entrega de webhook é at-least-once e at-least-once não é at-least-one — entrega perdida, deploy dentro da janela de retentativa ou endpoint que devolve 500 até o provedor desistir terminam do mesmo jeito, cliente pago e pedido não cumprido, e reconciliar exige poder **perguntar**; e **`refund(input)`**, que os dois gateways fazem integralmente. Reembolso **parcial** é capacidade (`supportsPartialRefund`) porque a AbacatePay reembolsa só integralmente e documenta isso. Assinatura ganhou as duas pontas: `mode: 'subscription'` no input (fecha (#39)) e `cancelSubscription` atrás de `supportsSubscriptions`. A divisão segue regra, não humor — um **valor** que o provedor não serve é validado e recusado em runtime (é assim que a AbacatePay já recusa moeda que não seja BRL); um **método** que ele não tem precisa ser visível ao compilador, senão quem consome escreve uma chamada que compila e estoura. (payments-multi-provider-2026-08)

  **Provado contra a API real do Stripe, sem browser.** Treze asserções rodam no ciclo noturno, incluindo as que fake nenhum sustenta: a mesma chave de idempotência devolvendo a mesma sessão; uma cobrança real confirmada com `pm_card_visa` e depois estornada integral e parcialmente; uma assinatura de fato `active` cancelada e então **relida do Stripe** para confirmar que pegou — afirmar o próprio retorno provaria só que o código concorda consigo mesmo. O provider da AbacatePay é implementado a partir da documentação publicada e coberto apenas contra fake: ninguém aqui tem conta, e o README diz isso onde o leitor vê antes de ligar o plugin, não em nota de rodapé.

  Essa distinção se pagou na hora: a documentação da AbacatePay se contradiz sobre o endpoint de status — o índice `llms.txt` diz `/checkouts/one`, o OpenAPI da mesma página diz `/checkouts/get` — e medir resolveu. Sem autenticação, `/checkouts/get` responde **401** (existe, exige auth) e `/checkouts/one` responde **400**, idêntico a uma rota inexistente. Seguir o índice teria shipado uma consulta de status que falha em toda chamada.

- **Suíte live do `payments` contra o Stripe real, e a asserção que foi medida e não escrita.** A central é a mesma do `email` e pelo mesmo motivo: `StripeProvider` passa `idempotencyKey` como **segundo** argumento de `sessions.create` — request option, não param — e as duas grafias compilam. É exatamente a forma do #37, que no `plugin-email` viajou como payload decorativo por meses enquanto o README dizia que funcionava; só o round trip distingue. Passou de primeira, e verde de primeira é quando a asserção precisa ser provada capaz de falhar: o defeito do #37 foi **replantado** no provider (chave movida para o payload), a suíte ficou vermelha com dois ids de sessão distintos, e restaurar devolveu os quatro verdes. Uma quarta asserção foi projetada, medida e **descartada antes de existir** — checar que todo key do `EVENT_MAP` ainda é um tipo de evento real do Stripe via `GET /v1/events?types[]=…`. Medido em 2026-08-18: `types[]=checkout.session.this_does_not_exist` devolve **HTTP 200 com lista vazia**, indistinguível de um tipo válido sem eventos, então a asserção passaria com um nome fabricado. É o defeito do `auth-github` de novo, desta vez pego antes do código e não depois. O Stripe não publica endpoint que enumere tipos válidos; aquele mapa fica coberto por revisão. (e2e-2026-08)

  Duas armadilhas registradas no registry e no `.env.example`: `STRIPE_TEST_PRICE_ID` precisa ser price **avulso** — `StripeProvider` fixa `mode: 'payment'` e o Stripe recusa recorrente nesse modo —, e os dez prices ativos da conta de teste do projeto são todos recorrentes, então a suíte não pôde emprestar nenhum e aponta para um produto descartável (`theokit-e2e — do not use`). Que o catálogo real seja inutilizável pelo contrato neutro é achado próprio, filado como (#39). A segunda: uma chave `sk_live_` faz a suíte inteira skipar com esse motivo impresso — `unsafeReason()` trata chave de produção como **não configurada**, não como algo a manusear com cuidado.

- **`@theokit/plugin-payments` passou a ser multi-provider: Stripe e AbacatePay atrás de um contrato único.** O pacote era Stripe até o osso — `payments()` devolvia um `getStripeClient()`, o dispatcher de webhook falava `Stripe.Event`, e a única forma de aceitar PIX no Brasil era não usar este plugin. Encaixar um segundo gateway ao lado do primeiro produziria duas superfícies paralelas sem nada em comum. O contrato neutro é a interseção **medida** do que os dois de fato fazem, não uma generalização de um deles: criar um checkout hospedado e receber uma URL de redirecionamento (`checkout.sessions.create → session.url` no Stripe, `POST /checkouts/create → data.url` na AbacatePay) e verificar um webhook de entrada. Isso é tudo — o que só um dos dois faz fica **fora**, porque interface que descreve capacidade que metade das implementações não tem obriga essas implementações a mentir (lançar `NotImplemented`, devolver null) e não ensina nada a quem lê o tipo. (payments-multi-provider-2026-08)

- **PIX é capacidade opcional tipada, não denominador comum.** A AbacatePay serve payload inline de QR (`POST /transparents/create` → `brCode` + `brCodeBase64`); o Stripe não tem equivalente. Em vez de dar ao `PaymentProvider` um `createPixCharge` de que o Stripe teria que lançar, ele vive em `PixCapableProvider`, alcançado pelo type guard `supportsPix` — então o compilador barra a chamada no Stripe, e a AbacatePay não é amputada para caber no formato do outro. `definePaymentProvider` recusa, no boot, um `createPixCharge` que não seja função: meia implementação é pior que nenhuma, porque o guard reportaria a capacidade como presente e a chamada falharia na hora em que alguém tenta pagar. (payments-multi-provider-2026-08)

- **`processPaymentWebhook`: verificação, deduplicação e despacho para qualquer provider.** O caminho Stripe tinha isso desde a 0.1; sem o equivalente neutro, a AbacatePay entraria como um provider **sem nenhuma idempotência** — o segundo gateway pior que o primeiro justamente naquilo que perde dinheiro, um pagamento processado duas vezes. A lógica de "reivindica o id antes de despachar, libera se o handler falhar, nunca deixa o texto do erro cruzar a fronteira HTTP" foi extraída para um núcleo compartilhado em vez de duplicada: são duas chances de errar o caminho de release, e o caminho de release é o que ninguém exercita à mão. (payments-multi-provider-2026-08)

- **`e2e/` — testes ao vivo contra as APIs reais dos provedores, no mesmo padrão do `theokit-gateways`.** As suítes em `packages/*/tests` provam o que este código faz contra fakes, e um fake concorda com quem o escreveu; o que elas não podem provar é que o contrato contra o qual programamos continua sendo o que o provedor serve. Só o Resend diz se o header de deduplicação ainda é `Idempotency-Key`. Cada suíte cobre três coisas e nada mais: a credencial chega ao provedor, o payload que montamos é aceito, e um erro real chega na forma que dizemos traduzir. Nada roda sem `E2E_LIVE=1`, e o pacote **não tem script `test`** — de propósito, para que `pnpm test`, que roda em todo push, não consiga gastar dinheiro nem enviar e-mail. O campo que estrutura o registry é como a credencial é exercitável sem humano: `api-key` cobre o caminho inteiro em CI; `oauth-redirect` só cobre a metade server-side, porque obter o código de autorização exige um browser e alguém clicando "permitir" — e essas suítes dizem qual metade cobriram em vez de sugerir as duas. Todo skip nomeia a variável exata que faltou, porque "5 skipped, 1 passed" lido de relance é indistinguível de seis serviços passando. Uma chave `sk_live_` do Stripe é **recusada**, não tratada com cuidado. `pnpm e2e:readiness` imprime o que está configurado e onde obter cada credencial que falta, e `.env.example` é gerado do mesmo registry, então não pode divergir do que o código lê. (e2e-2026-08)

  Quatro plugins ficaram deliberadamente de fora, e isso é achado, não lacuna: `plugin-db-drizzle` lê `DATABASE_URL` mas nunca conecta — registra verbos de CLI e uma aba de devtools, e repassa a URL ao drizzle-kit de quem consome; no `plugin-realtime` o Redis aparece só em comentário e exemplo, os providers que shipam são in-memory e Yjs; `plugin-canvas` renderiza em processo; `plugin-forms` é zod + react-hook-form. Suíte ao vivo para qualquer um deles seria teste unitário com latência extra.

- **Suíte live do `auth-github`, com uma única asserção — e o motivo é o achado.** O primeiro rascunho tinha quatro; duas foram **medidas e apagadas** por serem piores que nada. A que dizia "o GitHub aceita a URL de authorize que montamos" **passava com um client_id fabricado, e também com um vazio**: sem sessão autenticada, `/login/oauth/authorize` responde `302 → /login` antes de validar qualquer coisa, então a asserção não tinha como falhar — parecia cobrir o registro do app e não cobria nada. A do `redirect_uri` não registrado é inalcançável pelo mesmo motivo, porque o GitHub só valida isso depois do login. A terceira, do guard de `state`, dispara localmente sem tocar a rede: pertence ao teste unitário e aqui só somaria latência. Sobra a troca de token, que é a que vale: o GitHub recusa um código inválido com HTTP **200** e `{"error":"bad_verification_code"}`, não com 4xx — então `tokenRes.ok` é verdadeiro, o guard `token_exchange_failed` nunca dispara para a falha mais comum do fluxo, e o motivo que o próprio GitHub informou é descartado, de modo que quem consome não distingue código expirado de app revogado ou secret errado. Nenhum fake diria isso. O harness ganhou gate por variável (`requires`), porque uma credencial ausente não deve apagar asserções que nunca precisaram dela. (e2e-2026-08)

- **As credenciais OAuth do GitHub no e2e chamam-se `GH_OAUTH_*`, e o motivo é uma restrição que só aparece no CI.** Nomes de variável do registry viram nomes de secret do GitHub Actions, e a API recusa qualquer secret que comece com `GITHUB_`: `HTTP 422: Secret names must not start with GITHUB_.` Elas nasceram `GITHUB_OAUTH_*`, o que nada local reprovaria — um `.env` aceita qualquer nome — e a suíte passaria numa máquina local enquanto `secrets.GITHUB_OAUTH_CLIENT_ID` resolvia para string vazia toda noite no CI, reportando credencial ausente que ninguém conseguiria adicionar. Descoberto ao subir os secrets de verdade, não ao escrever o workflow. Registrado no registry e no README, porque é invisível até a execução agendada. (e2e-2026-08)

- **Contrato de erro do GitHub OAuth confirmado contra a API real:** um código de autorização inválido volta com **HTTP 200** e `{"error":"bad_verification_code","error_description":"The code passed is incorrect or expired."}`, não com 4xx. Logo, no `githubExchangeToken` do `@theokit/auth-github`, o guard `token_exchange_failed` **nunca dispara** para a falha mais comum do fluxo — o que surge é `missing_access_token` — e o `error_description` que o GitHub oferece é descartado, então quem consome não distingue código expirado de app revogado ou secret errado. A suíte live registra isso; o comportamento em si não foi alterado nesta entrada. (e2e-2026-08)

- **Contrato de empacotamento coberto para os onze pacotes — a metade que faltava do "teste ao vivo".** As suítes de provedor perguntam se o terceiro ainda aceita o que enviamos; esta pergunta a que custou mais caro: **se alguém instalar, isso carrega?** Nada em `packages/<nome>/tests` responde isso — testes unitários importam de `src/` pelo workspace, então nunca tocam `dist/`, nunca consultam `exports` e nunca percebem um subpath apontando para arquivo que o `files` não distribui. O #9 tinha exatamente essa forma: imports errados, suítes unitárias verdes, e a falha só visível quando um consumidor resolvia o pacote. São três asserções mecânicas por pacote — todo subpath de `exports` resolve para arquivo que o **tarball** de fato distribui (medido com `npm pack --dry-run`, não lido da árvore de trabalho), todo `.d.ts` declarado também é distribuído (um ausente rebaixa o consumidor a `any` silenciosamente, o que é pior que um erro), e a entrada principal importa com barrel não vazio. Cobre inclusive os quatro plugins sem serviço externo: eles não têm contrato de provedor, mas têm contrato de empacotamento, e é esse que quebrou. Roda sem credencial e sem rede, então entra no `ci.yml` de todo push e **não** é gated por `E2E_LIVE` — falha de empacotamento é nossa, não tarde ruim de provedor. Verificado adversarialmente em vez de presumido: plantar cada defeito (subpath para arquivo inexistente, `.d.ts` declarado e não distribuído, `files` sem o `dist`) deixa a suíte vermelha, e restaurar devolve os 45 verdes. (e2e-2026-08)

- **Suíte live do `auth-google` verifica uma decisão de segurança contra a realidade, e roda sem nenhuma credencial.** O documento de discovery do Google é público e o `createAuthorizationURL` o busca a cada chamada — o `clientId` só vira parâmetro de query, nunca é checado na busca —, então três asserções rodam com placeholder. A que importa: o `index.ts` **deliberadamente não** implementa o check SSRF de "host do endpoint descoberto == host do base" que a revisão prescrevia, e justifica em comentário que o discovery real do Google atravessa vários hosts, de modo que host-equality quebraria produção. Nada verificava isso. Agora sim, medido: `authorization_endpoint` em `accounts.google.com`, `token_endpoint` em `oauth2.googleapis.com`, `userinfo_endpoint` em `openidconnect.googleapis.com` — três hosts distintos, o que torna o guard mais frouxo o correto. Se o Google consolidar, a suíte fica vermelha e o comentário deixa de ser verdade, que é decisão de design a ser avisada e não descoberta depois. A asserção irmã cobre o outro lado: todos os endpoints em https, porque o guard aceita qualquer host https e passaria a recusar tráfego real no dia em que um deles não fosse. A metade dependente de credencial (mapeamento de erro do token exchange) fica separada, para que as asserções de discovery não fiquem reféns de um client secret inexistente. (e2e-2026-08)

- **Suíte live do `voice`, com um round trip que nenhum fixture reproduz.** As suítes unitárias injetam `fetchImpl`, então provam que a requisição **montada** é a pretendida — não que a OpenAI ainda a aceita, e o formato é dela: multipart em `/v1/audio/transcriptions`, JSON em `/v1/audio/speech`. A asserção central faz as duas metades se checarem: o TTS sintetiza áudio de verdade, esse áudio alimenta o STT, e a transcrição precisa conter as palavras faladas. Nenhuma das metades consegue falsear isso sozinha — TTS quebrado gera áudio que o STT não lê, STT quebrado falha sobre áudio comprovadamente bom, e um `.wav` enlatado só testaria o STT. A comparação é por palavras de conteúdo, não igualdade de string, porque o Whisper pontua e capitaliza à vontade e fixar o texto exato transformaria mudança de formatação em contrato quebrado. Custa fração de centavo por execução. O backend Groq é opcional e fica em `describeLive` próprio: sem `GROQ_API_KEY` aquele teste skipa e o caminho OpenAI segue rodando. (e2e-2026-08)

  Armadilha de nomenclatura registrada no registry: a chave estava no ambiente como `OPEN_AI_API_KEY`, e o plugin lê `OPENAI_API_KEY` (`DEFAULT_STT_ENV_VAR` / `DEFAULT_TTS_ENV_VAR`). Com a outra grafia a credencial **parece** configurada e silenciosamente não está — a suíte skiparia nomeando uma variável que o dono jura ter definido.

- **`copilot`: cobertura live registrada onde ela existe, em vez de duplicada.** A sonda de LLM real do pacote já percorre o caminho inteiro — `defineCopilot` + `CopilotRuntime` + `Agent.prompt` + OpenRouter — e passa contra `gpt-4o-mini`. Copiá-la para o `e2e/` só afirmaria a mesma coisa duas vezes, e ela depende de um fixture in-memory de `CopilotRealtimeProvider` que o pacote não exporta. O registry ganhou `coveredElsewhere`, e o readiness passa a imprimir "live suite lives outside e2e/" com o caminho, em vez de listar o serviço como sem cobertura: **"sem suíte aqui" e "não coberto" são afirmações diferentes**, e imprimir a primeira como se fosse a segunda é exatamente a confusão que este pacote existe para evitar. Duas coisas mantêm isso honesto — a sonda é gated por `E2E_LIVE` além da chave, então `pnpm test` não gasta com ela, o que obriga o workflow noturno a invocá-la pelo nome (e ele invoca); e uma asserção do readiness confere que o arquivo apontado existe, porque ponteiro para cobertura que mudou de lugar é pior que ponteiro nenhum — o relatório afirmaria a lacuna fechada enquanto nada roda. Verificado nos dois sentidos: apontar para um arquivo inexistente deixa o readiness vermelho. (e2e-2026-08)

  Duas chaves do OpenRouter encontradas no ecossistema estavam **revogadas** (HTTP 401 em `/api/v1/key`); a válida tinha limite de US$ 5 e uso zero. Testar as três antes de escolher evitou uma suíte que falharia por credencial morta e pareceria bug de produto.

- Secret scanning em duas camadas: um hook `pre-commit` que varre com o TruffleHog o conteúdo que está staged e recusa o commit, e `.github/workflows/secret-scan.yml`, que revarre no CI o intervalo empurrado. O hook é o que impede a credencial de entrar no histórico; o workflow é o que `git commit --no-verify` não consegue pular. Falsos positivos confirmados são silenciados linha a linha com um comentário `trufflehog:ignore`, nunca excluindo o caminho — excluir o caminho esconderia também um segredo real acrescentado depois àquele mesmo fixture. (secret-scanning-2026-08)

### Changed

- **Breaking em `@theokit/plugin-payments@0.3.0`: todo export específico do Stripe mudou para o subpath `/stripe`.** Nada foi removido nem renomeado — `payments`, `defineStripeWebhook`, `WebhookRegistry`, `processWebhook`, `createCheckoutSession`, `verifyAndParseWebhook` e os erros do Stripe passam a vir de `@theokit/plugin-payments/stripe`; `createMemoryStore`, `createOrmStore`, `IdempotencyStore` e os helpers de moeda continuam no import de topo, porque idempotência e aritmética de unidade mínima não são do Stripe. São subpaths e não um bundle só de propósito: uma loja brasileira que aceita apenas PIX não deve carregar os tipos do SDK do Stripe no build dela, e nenhuma das duas peerDependencies é exigida enquanto o subpath correspondente não for importado — verificado no artefato, `dist/abacatepay.js` importa `node:crypto` e nada mais. A quebra é aceitável agora porque o pacote está em 0.2.1 e não tem consumidor no ecossistema; adiar tornaria o custo real. (payments-multi-provider-2026-08)

- **O repositório passou para a organização oficial `usetheokit`.** Clones existentes continuam funcionando: o GitHub redireciona permanentemente o remote antigo `usetheodev/theokit-plugins`. Os campos `repository`, `bugs` e `homepage` de todos os pacotes, o README e o `CONTRIBUTING.md` agora apontam para `usetheokit`. (usetheokit/theokit#316)

- **A licença passou de MIT para Apache-2.0, alinhando-se ao restante do ecossistema.** Os doze pacotes deste repositório eram os únicos sob MIT enquanto todo o resto do TheoKit é Apache-2.0 — a divergência obrigava quem consome mais de um pilar a conciliar dois regimes de licença, sem que houvesse decisão registrada a favor disso. A Apache-2.0 adiciona concessão explícita de patente, que a MIT não tem. O relicenciamento foi verificado quanto à titularidade: o histórico deste repositório tem apenas duas identidades de autor, ambas do mantenedor, sem contribuições de terceiros a relicenciar. (usetheokit/theokit#316)

- Hook de validação de comandos ficou mais rápido: ~6 processos por chamada de ferramenta em vez de ~50, sem mudança de comportamento

- O README do `@theokit/plugin-voice` não referencia mais `@theokit/plugin-cors`, pacote que não existe neste repo. (docs-reorg-2026-08)
- `ROADMAP.md` deixa de apontar para um roadmap cross-pillar em `theokit-tools/ROADMAP.md` — esse arquivo de nível de grupo não sobreviveu à reorganização de 2026-08 e não existe em lugar nenhum. (docs-reorg-2026-08)

### Deprecated

### Removed

- O gate `tests/lint/no-ptbr.test.ts` (varredura English-only do repositório) foi removido junto com a pasta `tests/` da raiz. Ele nunca foi executado por gate algum: `pnpm test` percorre somente `./packages/*`, não há `vitest.config` na raiz, `pnpm lint` cobre apenas `packages/**` e o `include` do `tsconfig.json` raiz é `packages/*/src` + `packages/*/tests` — a `tests/` da raiz ficava fora de todos eles. O repositório declarava uma proteção que não estava ligada em lugar nenhum; removê-la não reduz nenhuma verificação que estivesse de fato rodando. (B-065)

### Fixed

- **O release deixou de passar em verde quando o PR de versão não é aberto (#16).** Quando o token não pode criar pull request, o `changesets/action` ainda empurra a branch `changeset-release/main` e o job **termina verde**: os changesets ficam pendentes, nenhuma versão sobe, nada publica, e o único sinal é uma branch que ninguém observa — que é exatamente como um release quebrado sobreviveu cinco execuções em dois meses. Um step novo falha quando `hasChangesets` é verdadeiro, `pullRequestNumber` é vazio e nada foi publicado — a única combinação que representa esse estado — e escreve no summary do job o diagnóstico com as duas saídas possíveis. Verificado executando o corpo do step (sai 1, escreve 27 linhas) e avaliando a condição nos quatro estados: falha só naquele. (release-hardening-2026-08)

  O workflow passou a aceitar `RELEASE_PAT` com fallback para `GITHUB_TOKEN`, então adicionar o secret é o único passo necessário e, sem ele, o comportamento é idêntico ao de antes. A escolha entre as duas saídas continua sendo do dono e está documentada no lugar onde ela aparece: virar a flag da **organização** também concede ao Actions **aprovar** pull request em todos os repositórios dela, o que é vetor de bypass de review ao lado de review obrigatório; um PAT confina a concessão a este workflow. Medido, a flag do repositório não sobrepõe a da org — a API responde `409 The organization does not allow GitHub Actions to create or approve pull requests`.

- **Uma afirmação minha, não medida, corrigida no `AbacatePayProvider`.** O docstring dizia como fato que um erro da AbacatePay "pode chegar com HTTP 200" — veio da descrição do envelope `{data, success, error}` nos docs, não de uma resposta. Medido: toda recusa chega com 4xx (400 `"No products found"`, 422 em corpo malformado). O guard que checa `res.ok` **e** `error` fica, porque custa nada e um corpo `success:false` atrás de um 200 devolveria `undefined` como URL de checkout; o que mudou é a etiqueta — cobertura **defensiva** de uma forma que a API nunca produziu, não contrato medido. Mesmo padrão aplicado a três afirmações deles no mesmo dia, agora a uma minha. Sem mudança de comportamento. (abacatepay-live-2026-08)

- **Três defeitos do `AbacatePayProvider`, todos vindos de confiar na documentação em vez de medir (#41).** O terceiro é o mais grave e nenhum teste unitário podia pegá-lo. (abacatepay-live-2026-08)

  **1. Estorno bem-sucedido lançava erro.** Os docs mostram `{ refundPublicId }`; a API devolve `{ id, status: "COMPLETE", amount, originalId, createdAt }`. Lendo só a chave documentada, o provider lançava `refund_failed` em **todo estorno que funcionou**. Invisível para o teste unitário porque o fake tinha sido escrito a partir dos mesmos docs — é o mesmo padrão do `re_xxx` no `plugin-email`, onde o fake ensinou o contrato errado. Agora aceita as duas chaves, e o fake ensina a forma **medida**.

  **2. O roteamento por prefixo do estorno foi restaurado depois de eu tê-lo apagado.** A tabela de prefixos dos docs afirma que `/checkouts/refund` aceita `bill_`, `char_`, `pix_char_` e `card_`, o que fez o branch parecer um que "só podia estar errado" — e eu o removi com esse argumento escrito na mensagem de commit. A API discorda: `POST /checkouts/refund { id: "pix_char_…" }` responde `"Use a rota /v2/transparents/refund para reembolsar cobranças transparentes."`, e `/transparents/refund` aceita e completa. Documentação perdeu para medição; o branch é load-bearing.

  **3. `createCheckout` não conseguia criar nada nesta loja.** Sem `methods`, a API herda o default que inclui CARD e responde `"CARD is not available for this store"`. A AbacatePay desde então **comentou o CARD fora dos próprios docs**, o que faz PIX-only ser a norma, não borda. Virou opção do provider — `AbacatePayProvider({ apiKey, methods: ['PIX'] })` — e não campo do `CheckoutInput`, porque quais métodos uma loja suporta é configuração de conta, definida uma vez onde a chave é configurada.

  Registrado também o que **não** dá para cobrir, medido em vez de presumido: assinaturas (a AbacatePay comentou a seção inteira dos docs, e `/subscriptions/create` responde `"PIX Automático is not available for this store"` — endpoint existe, capacidade não); entrega de webhook (exige endpoint HTTPS público, e assinar localmente para verificar localmente só provaria que nosso HMAC concorda com o nosso HMAC); e `GET /store/get`, endpoint documentado que responde `"Not found"`, então as capacidades da loja não podem ser lidas programaticamente.

- **Os plugins passaram a ser adaptadores do TheoKit de fato, e dois deles paravam de tipar contra uma API inexistente (#42).** Medido: dos 11 pacotes, **nenhum** usava a API de autoria de plugin do framework, e dois declaravam um `TheoPluginApp` local descrevendo métodos que o `TheoApp` não tem — `registerRoute`/`hasRoute` no payments, `registerModule`/`registerCliCommand`/`registerDevtoolsTab`/`hasCliCommand` no db-drizzle. Os dois compilavam porque TypeScript é estrutural e o parâmetro nunca era usado. O contrato real é `{ addHook, decorateRequest }`, e `import type` é apagado no build — então importar o de verdade não custa nada em runtime, o que o `plugin-voice` já documentava a dois diretórios de distância. (adapters-2026-08)

  **`plugin-payments`**: o `register()` publica a superfície em `ctx.payments`, o equivalente do `@InjectStripeClient` do NestJS. Ela é deliberadamente mais estreita que o plugin — `providers`, `provider(key)`, `handleWebhook`, e **não** `store` nem `registry`. A estreiteza compra uma propriedade de segurança e não arrumação: um handler com `store` reivindica ou libera um id de evento fora do dispatcher e derruba a idempotência; um com `registry` reescreve o roteamento no meio da requisição. O `stripePayments()` publica o client em `ctx.stripe` e o **resolve no boot**, então chave ausente virou crash na subida em vez de 500 no meio de um pagamento.

  **Prosa corrigida junto**: o README dizia que "nenhuma rota é registrada automaticamente" como decisão de design e prometia um opt-in `autoRegisterRoutes`. Um plugin do TheoKit **não pode** registrar rota — o `PluginBuilder` tem hooks, `decorateRequest` e `build()`, nada mais. Era limitação de plataforma apresentada como escolha, escrita sem ler o contrato.

  **Regra 4 no `check:manifests`**, para os 9 restantes não poderem ficar errados em silêncio: nenhum pacote declara um tipo que o framework possui, e todo peer em `theokit` é usado ou consta numa lista de triagem com o motivo e a forma do trabalho que removeria a isenção. Verificado nos três sentidos — tipo fabricado reintroduzido, isenção removida, isenção obsoleta: o gate nomeia cada um. A mensagem para `TheoPluginApp` é diferente de propósito: mandar importá-lo seria mandar procurar algo que nunca existiu.

- **`node:` sobrevive ao build em todos os onze pacotes, com guard que impede a volta (#38).** O tsup 8 remove o prefixo por padrão, então `node:crypto` era publicado como `crypto` puro — que Deno, Bun e runtimes tipo Workers não resolvem. Atingia `auth-magic-link`, `plugin-realtime` e `plugin-voice`; o `plugin-payments` já tinha sido corrigido no commit anterior. O que faltava não era o fix de uma linha, era alguém perceber: o **código-fonte estava certo** e nenhum teste unitário lê o artefato construído. O contrato de empacotamento passou a ler — uma asserção por pacote, comparando cada especificador de import contra a lista de builtins do Node, e a comparação é contra a lista e não contra um regex de `node:` porque um `crypto` puro poderia em tese ser um pacote npm real; o que quebra resolução é a colisão com o nome do builtin. Verificado nos dois sentidos: rodado contra o `dist` defeituoso, acusa exatamente os três pacotes que a issue nomeia; depois do rebuild, 45 → **56 asserções** verdes. (payments-multi-provider-2026-08)

- **`verifyWebhook` lançava de forma síncrona apesar de declarar retorno `Promise`.** Header de assinatura ausente ou secret não configurado escapavam do `.catch()` de quem chamava e derrubavam a requisição em vez de virar um 400. Descoberto pelo primeiro teste que usou `rejects` — o `async` nos dois providers agora é load-bearing e está comentado como tal, porque removê-lo não quebra nenhum tipo, só o comportamento. (payments-multi-provider-2026-08)

- **Ids de evento passaram a ser namespaced por provider no store de idempotência compartilhado.** Nada garante unicidade **entre** gateways: os dois podem emitir `evt_1`, e sem prefixo o segundo seria engolido como duplicata e aquele pagamento nunca seria cumprido. Custa uma concatenação. (payments-multi-provider-2026-08)

- **O prefixo `node:` sobrevive ao build do `plugin-payments`.** O tsup 8 remove `node:` por padrão (`removeNodeProtocol`), então `node:crypto` era publicado como `crypto` puro — que Deno, Bun e runtimes tipo Workers não resolvem. Todos os pacotes deste repositório ainda publicam assim (por exemplo `auth-magic-link`, que emite `from "crypto"`); este deixou de publicar, porque `/abacatepay` é entrada nova e não havia motivo para nascer com o defeito. O default inverte no tsup 9. Os três pacotes restantes estão registrados em (#38). (payments-multi-provider-2026-08)

- **`@theokit/plugin-canvas` e `@theokit/plugin-forms` passaram a funcionar com o `@theokit/ui` atual.** O `@theokit/ui@1.0.0` moveu seus 54 componentes não-AI para o `@usetheo/ui` e ficou AI-exclusive; estes dois pacotes nunca rodaram essa migração e seguiram importando `Alert`, `Button`, `CodeBlock`, `CopyButton`, `DropdownMenu`, `FormField` e `Tooltip` de um pacote que não os exporta mais. No workspace isso deixava `pnpm typecheck` (10 erros), `pnpm build` (DTS) e 4 suítes vermelhos — e, como o workflow de release roda `pnpm build`, nenhuma versão nova podia sair. `DiffViewer` continua no `@theokit/ui`: é componente AI e não migrou. **Quem consome precisa instalar `@usetheo/ui` (`>=0.22.0 <1`)** — peer obrigatória no canvas, opcional no forms (só o tier estilizado usa; o hook `useTheoField()` segue sem peer). Verificado no registro após a publicação: `@theokit/plugin-canvas@0.4.0` instalado num projeto limpo importa `@theokit/plugin-canvas/ui` com 32 exports e nenhum símbolo ausente. (#9)

  Precisão sobre o que estava publicado, corrigindo o que uma versão anterior desta entrada afirmava: as versões no registro (`plugin-canvas@0.3.3`, `plugin-forms@0.1.4`) declaram peer `@theokit/ui@^0.14.2` — a era **pré-split**, quando aquele pacote ainda exportava as primitivas. Eram internamente consistentes com a época em que saíram; o que elas não eram é compatíveis com o `@theokit/ui@1.x` que qualquer instalação nova resolve. A contradição real vivia **no repositório e nunca foi publicada**: peer declarada em `^1.1.0` (pós-split) com imports escritos para `0.14.x` (pré-split). Não foi verificado se a `0.3.3` carregava de fato com `@theokit/ui@0.14.x` — três tentativas de montar esse ambiente falharam com `ERESOLVE` em cascata — então isso fica registrado como não verificado, e não como funcionando ou quebrado.

- **O CI voltou a poder passar.** Nove dos onze pacotes declaravam `"theokit": "link:../../../theokit/packages/theo"` como devDependency — um caminho fora do repositório, que existe só na máquina de quem o criou. No runner o `theokit` não resolvia, e os três jobs caíam juntos: `typecheck` com `TS2307` em `theokit/server` e `theokit/server/auth`, os testes do `auth-google` com `ERR_MODULE_NOT_FOUND`, e o `lint` com 30 erros `no-unsafe-*` que eram apenas o reflexo dos tipos irresolvíveis. Passou a apontar para `theokit@^0.48.7`, do registro — exatamente a mesma versão que o diretório linkado continha, então nada muda de comportamento. Isso não afetava quem consome os pacotes (devDependency não é distribuída); afetava a capacidade do repositório de verificar a si mesmo. Para desenvolver contra uma versão local do `theokit`, use um override local não comitado em vez de um `link:` no `package.json`. (#13)

- **O passo de versionamento do release nunca rodou.** O `release.yml` passava `version: pnpm version` ao Changesets, e `version` é comando nativo do npm/pnpm: sem argumento semver ele imprime `process.versions`, sai com 0 e **não executa** o script de mesmo nome. Resultado: `changeset version` jamais foi chamado, cada release empurrava uma branch `changeset-release/main` idêntica à `main` — changesets intactos, nenhuma versão bumpada — e o passo ainda parecia ter funcionado. O script foi renomeado para `version:packages`, fora da palavra reservada, e o workflow passa a invocá-lo com `pnpm run` explícito; renomear é o que impede a armadilha de voltar caso alguém remova o `run`. (#15)

- **O hook de secret scanning deixou de ser instalado no CI, onde bloqueava o release.** O script `prepare` apontava `core.hooksPath` para `.githooks` em qualquer ambiente, inclusive no runner. Quando o Changesets tentava criar o commit `Version Packages`, o `pre-commit` procurava o `trufflehog`, não o encontrava no PATH do runner e — corretamente, porque é fail-closed — recusava o commit. O bump chegava a ser calculado e era descartado ali. O `prepare` passa a não fazer nada quando `CI` está definido; a cobertura no CI continua sendo o `secret-scan.yml`, que é a camada projetada para isso. Nenhuma verificação foi perdida: localmente o hook segue idêntico. (#19)

- **Um bump de peer dependency deixou de arrastar dependentes que já estavam dentro do range.** O `@theokit/plugin-copilot` declara `@theokit/plugin-canvas` como peer em `>=0.3.3`; ao subir o canvas para `0.4.0`, o Changesets reescrevia o range e bumpava o dependente — e a regra dele para dependentes por peer é _major_, o que num pacote `0.x` levava `0.1.2` direto a `1.0.0`, sob um CHANGELOG rotulado "Patch Changes". O pacote não tinha mudança alguma, e `>=0.3.3` já aceitava `0.4.0`, então o bump era desnecessário além de desproporcional: publicaria um `1.0.0` declarando API estável que ninguém decidiu declarar. `onlyUpdatePeerDependentsWhenOutOfRange` passa a valer, e o dependente só é bumpado quando a nova versão de fato sai do range declarado. Verificado: com a opção ligada, `changeset version` produz canvas `0.4.0`, forms `0.2.0` e copilot intocado em `0.1.2`. (#22)

- **O CI passa a rodar na promoção `workspace → develop`, que até agora entrava sem verificação nenhuma.** O `ci.yml` disparava só com base `main`, e as duas pernas do fluxo são PRs — então um PR para `develop` não rodava `lint`, `typecheck`, `build` nem `test`, e quem revisava via "todos os checks passaram" vindo apenas do secret scan. A branch cuja função é integrar aceitava código nunca verificado. Foi esse furo que escondeu por meses o `link:` local do `theokit` e, atrás dele, o release quebrado. Os dois bases passam a ser listados, como o `secret-scan.yml` já fazia; `workspace` fica fora do `push` de propósito, porque toda promoção a partir dela é PR e o gatilho de `pull_request` já cobre aquele commit. Como ampliar os gatilhos multiplica execuções, runs em voo passam a ser superseded — nunca em `main` ou `develop`, cujos runs são o registro do que a branch protegida de fato passou. O comentário que dizia "quando `packages/` está vazio os jobs passam" saiu: descreve um estado que não existe desde os 11 pacotes, e é a mesma premissa que este CHANGELOG já registrou ter escondido dois gates quebrados. (#11)

- **A publicação no npm passou a poder autenticar.** O `changeset publish` chama `npm publish`, e o trusted publishing por OIDC só existe a partir do npm `11.5.1` — mas o Node 22 do `setup-node` traz o `10.9.7`, que não tem código de OIDC algum (medido nos tarballs: `10.9.7` → 0 arquivos, `11.4.1` → 0, `11.5.1` → 2). Sem isso o CLI publicava sem credencial e o registro respondia `E404 Not Found - PUT`, que é o que ele devolve em vez de `403` para não revelar a existência de um pacote a quem não pode publicá-lo. A mensagem dizia que `@theokit/plugin-canvas@0.4.0` "não está neste registro" — sobre um pacote cuja `0.3.3` está publicada — e mandava procurar erro de digitação em vez de um CLI velho. Duas pistas reforçavam o engano: o `changesets/action` anuncia `OIDC is available - using npm trusted publishing` sem verificar se o CLI sabe usá-lo, e a assinatura de provenance funcionava no mesmo run, porque provenance usa OIDC desde o npm 9.5 e é mecanismo distinto de autenticação. O workflow passa a instalar `npm@^11.5.1` antes de publicar. Isso não substitui o vínculo de trusted publisher no npmjs.com: as duas metades são necessárias — o vínculo autoriza o workflow, esta linha é o que faz o CLI apresentar o token que o vínculo confere. (#29)

- **Nove dos onze pacotes não declaravam `repository`, e com provenance ativada nenhum deles podia ser publicado.** A provenance assinada pelo GitHub Actions carrega o repositório de origem, e o npm valida essa afirmação contra o `repository.url` do `package.json`; ausente, a comparação era contra string vazia e o registro recusava o bundle com `E422 ... "repository.url" is "", expected to match "https://github.com/usetheokit/theokit-plugins"`. É por isso que o `plugin-canvas@0.4.0` publicou no mesmo run em que o `plugin-forms` falhou: canvas e voice eram os dois únicos que já tinham o campo — a diferença não era permissão, era metadado. Os nove passam a declarar `repository` (com `directory`, por ser monorepo), `homepage` e `bugs`, no padrão que os outros dois já usavam. Sem changeset de propósito: o `plugin-forms` já tinha `0.2.0` pendente e sai com o campo, e os outros oito recebem o metadado no próximo release com razão própria de existir — cortar oito versões só para metadado seria o desperdício que a entrada anterior descreve. (#34)

- **A sonda de LLM real do `plugin-copilot` deixou de cobrar de quem só rodou `pnpm test`.** `tests/integration/copilot-real-llm.test.ts` era gated apenas pela presença de `OPENROUTER_API_KEY`, e `pnpm test` alcança esse arquivo — então qualquer pessoa com a chave exportada no shell, o que inclui todo mundo que já rodou a sonda uma vez, pagava por uma ida ao LLM em cada execução de teste sem relação com isso. Passa a exigir também `E2E_LIVE`, o mesmo portão do `e2e/`. Continua morando no pacote, e não no `e2e/`, porque depende de um fixture in-memory de `CopilotRealtimeProvider` que não é exportado. (e2e-2026-08)

- **`pnpm check:manifests` passa a barrar, em todo push, o que antes só aparecia no primeiro release de um pacote.** Três regras, cada uma correspondendo a um defeito que custou um release: `repository` presente e com `directory` correto (sem ele o npm recusa o upload com `E422`, porque não consegue casar a provenance assinada com o pacote), nenhum `link:`/`file:` (um caminho local resolve para nada no runner, e foi o que tornou os três jobs impossíveis de passar), e `publishConfig.provenance` declarado por pacote (o workflow já liga provenance globalmente, mas a declaração local mantém a garantia quando alguém publica à mão — foi assim que as nove versões de 2026-07-10 chegaram ao registro sem atestação). O gate encontrou de imediato duas violações que ninguém tinha visto: `plugin-copilot` e `plugin-realtime` sem `publishConfig.provenance`, ambos corrigidos. Entra no job `Typecheck + Build`. (#34, #13)

- **`@theokit/plugin-email`: `idempotencyKey` não fazia nada, e o e-mail era enviado duas vezes.** A chave era escrita em `payload.headers` — cabeçalhos **MIME da mensagem** — enquanto o Resend deduplica pelo cabeçalho **HTTP `Idempotency-Key` da requisição**, que o SDK aceita somente no segundo argumento de `emails.send`. Ou seja: a chave viajava como um cabeçalho decorativo e a deduplicação nunca acontecia. Quem contava com ela para tornar um retry seguro — redelivery de webhook, reprocessamento de fila — **entregava a mensagem duas vezes**, e o README afirmava que funcionava. Passa a ser `send(payload, { idempotencyKey })`; os `headers` do consumidor seguem intactos na mensagem. Encontrado pela suíte live na primeira execução real: a mesma chave duas vezes devolveu dois ids diferentes. O teste unitário afirmava `payload.headers['Idempotency-Key']` sob o nome "maps to Idempotency-Key HTTP header" — as duas coisas não podem ser verdade, então ele passava. Verificado contra a API real: dois envios com uma chave agora devolvem o mesmo id. (#37)

  Achado secundário da mesma origem: os mocks devolviam `id: 're_xxx'`, mas ids de mensagem do Resend são **UUID** — `re_` é prefixo de **API key**. O fake ensinou o formato errado e a primeira versão da suíte live herdou o engano antes de a API corrigi-lo. Todos os ids irreais nos testes do pacote foram trocados por UUIDs, porque um fake com formato inventado é uma armadilha para quem escrever o próximo teste.

- O gate de migração falhou silenciosamente e vale registrar: o codemod oficial (`@theokit/ui/codemod/split-usetheo.mjs`) não reescreve nada num repositório sem ponto e vírgula — a regex dele exige `;` no fim do import — e ainda assim imprime `codemod applied to N file(s)`, porque conta os argumentos recebidos, não os arquivos alterados. Os imports daqui foram reapontados à mão, conferindo com a lista `MOVED` do próprio codemod. Reportado em `usetheokit/theokit-ui#41`. (#9)

### Security

## [0.3.0] - 2026-07-10

### Added

- Roadmap converted to a milestone-tracked format and amended: added `## M0 — [x]` (shipped plugin cluster baseline) and `## M1 — [ ] Architecture remediation (audit 2026-07-10)` covering the four findings of the 2026-07-10 architecture audit (score 88/100, verdict KEEP); added the `## State-of-the-art references` anchor (`/roadmap-feature architecture-remediation`)
- Architecture audit (2026-07-10, loop-codebase-architect) of the 11 `@theokit/*` packages — verdict KEEP (88/100); 1 critical (canvas circular dependency) + 3 low normalizations, full report + migration plan in `architect-output/`

### Changed

- **M2 — Lint & format compliance.** Brought the workspace to `pnpm lint --max-warnings=0` (437 pre-existing ESLint errors across all 11 packages) and `prettier` green. The CI `lint-and-format` job had only ever passed while `packages/` was empty, so the shipped plugins never satisfied the strict gate. All fixes are behavior-preserving (665/665 tests still green): `require-await` → `Promise.resolve(...)` where a Promise contract is required; `no-unsafe-*` → precise types (no `any`); `unbound-method` → property signatures / arrow wrappers. Scoped the prettier gate to product source via `.prettierignore` (excludes the synced `.claude` cycle-kit + generated `knowledge-base` / `agents` audit trail + `architect-output`).

### Fixed

- Workspace `pnpm typecheck` was silently broken — the root `tsconfig.json` never set `jsx`, so every `.tsx` source failed `tsc --noEmit` (33 errors) and the CI `typecheck-build` job only passed while `packages/` was empty. Added `"jsx": "react-jsx"` to the root config and fixed the remaining 7 type errors (voice `fetchImpl` mock-type mismatch, a dead `??` in the canvas markdown renderer). Root typecheck is green again (0 errors) (M1)
- M1 architecture remediation — see per-package changesets: `@theokit/plugin-voice` (theokit M31 `defineTheoPlugin` boot crash + `src/server/` relocation), `@theokit/plugin-canvas` (broke the `canvas-panel` ↔ `canvas-toolbar` import cycle), `@theokit/plugin-email` (`defineEmailProvider` fail-fast validation)

## [0.2.0] - 2026-06-17

### Added

- Code review audit (2026-06-16) of all 11 `@theokit/*` packages — 72 findings (1 critical, 26 high, 34 medium, 11 low) in `code-review-output/final_report.md`
- Remediation plan for all 72 findings — `knowledge-base/plans/remediate-code-review-2026-06-16-plan.md` (verdict SHIPPABLE 96.8) + edge-case review

### Changed

- Reduced the cyclomatic complexity of eight functions flagged by the audit (CC 16–24) by extracting behavior-preserving named helpers — no behavior change, all existing tests stay green: `auth-github` `github()` callback, `plugin-canvas` `createInMemoryArtifactStore`/`serializeArtifactForCopy`/`classifyRemoved`, `plugin-copilot` `defineCopilot`, `plugin-realtime` subscription effect, and `plugin-voice` `handleSttRequest`/`handleTtsRequest` (#182, #183, #184, #185, #186, #187, #188, #189)
- plugin-forms: `TheoForm`'s error routing is extracted into exported `routeActionError`/`extractFieldsFromError` helpers (no behavior change) so the routing (ActionInputError fields → RHF `setError`; other errors re-thrown) is unit-tested against the same single source the component uses, instead of a duplicated copy of the catch-block logic (#227)
- plugin-canvas: removed a no-op `try/catch` around the agent-tool security gate (internal cleanup, no behavior change) (#181)
- plugin-payments: `payments()` now logs a loud warning when it falls back to the default in-memory idempotency store under `NODE_ENV=production` — that store is not multi-replica safe; pass an explicit `idempotencyStore` in production (#202)

### Removed

- Stale prior-run review artifacts from `code-review-output/` (2026-06-11 phase reports + figures superseded by the 2026-06-16 audit)

### Fixed

- plugin-payments: a failure while releasing the idempotency claim after a webhook handler error is now logged with secrets redacted, instead of logging the raw error object — a `release()` error carrying credentials (e.g. a DB connection string) no longer leaks into the server log. Mirrors the existing redaction on the handler-error log (review finding F-dom-pay-5)
- auth-google: a discovered OIDC endpoint at `http://0.0.0.0:PORT` is now rejected as an insecure (plaintext) URL instead of being treated as loopback-exempt. `0.0.0.0` is the wildcard bind address, not a loopback destination, so a poisoned discovery document could previously route a `client_secret`-bearing request over plaintext http; only genuine loopback hosts (`localhost`, `127.0.0.0/8`, `::1`) remain http-exempt (review finding F-sec-3)
- plugin-copilot: untrusted user text framed for the agent now has forged fence markers stripped to a fixpoint, so a nested payload like `<<<UNTRUSTED_USER<<<UNTRUSTED_USER_INPUT>>>_INPUT>>>` can no longer reconstruct a fence marker and escape the untrusted-data block. The previous single-pass strip left a reconstructed marker behind (prompt-injection hardening, OWASP LLM01; review finding F-sec-2)
- plugin-canvas: the HTML `srcdoc` security gate no longer misses an **unquoted** `<meta http-equiv=refresh>` (or any iframe / object / embed / on-handler / `javascript:` / `data:` vector). The verdict is now derived from what DOMPurify actually removed (parsing the srcdoc as a whole document, the way a browser renders an iframe `srcdoc`) instead of a regex that only matched a quoted `http-equiv` — so a crafted unquoted meta-refresh artifact is correctly rejected by `enforceArtifactSecurity` rather than passing as clean (review findings F-arch-1, F-sec-1)
- plugin-copilot: a throw from the typing-indicator update (`setTyping(true)`) at the start of an agent invocation now releases the held budget reservation instead of leaking it — the call was moved inside the try that owns the reconcile/release path (review finding F-conc-2)
- plugin-copilot: the per-room round-robin dispatcher state (`roundRobinCursor`/`roundRobinDecision`) is now pruned when a room's last copilot unregisters, fixing an unbounded-memory growth across long-running processes that cycle through many transient rooms. Pruning is guarded so a room with remaining copilots keeps its rotation state (review finding F-arch-2)
- plugin-voice: `<VoiceRecorderBar>` now passes its `onError` handler to the recorder, so a `MediaRecorder` error that fires mid-recording (no `stop()` pending) surfaces via the bar's `onError` + error state instead of being silently lost while the bar stays in the recording state. The `recorderFactory` test seam now receives the recorder options (review finding F-wire-1)
- plugin-copilot: the README Quick start now matches the real API — `CopilotProvider` takes `userConnectionId` (not `localConnectionId`) and has no `runtime` prop, and the headless hooks use their object-argument signatures (`useCopilotReadable({ description, value })`, `useCopilotTool({ name, description, handler })`). The documented integration path now compiles and runs as written (guarded by a test that mirrors it) (#172, #173)
- plugin-copilot: budget usage now reflects the provider's actual reported cost (from the agent's `complete` event `usage.costUsd`) instead of always charging a fixed per-invocation estimate; when the provider reports no cost, it falls back to the configured estimate. Builds on the reservation model (the reservation is reconciled to the actual on completion) (#174)
- plugin-copilot: the agent completion is now validated against a real `z.object({ text: z.string() })` schema instead of a passthrough that accepted any shape — a non-conforming completion is rejected rather than silently coerced (#224)
- plugin-copilot: the `round-robin` dispatcher now rotates fairly across copilots in a room. The cursor is keyed by room (not by connection) and the dispatch decision is computed once per frame, so exactly one copilot responds per frame and rotation is shared across connections — previously every copilot responded to every frame (round-robin behaved like `all`) (#220)
- plugin-copilot: a failed queued frame/idle task is now logged with copilot + room context instead of being silently swallowed by an empty catch — the chain stays alive but failures are observable (#222)
- plugin-copilot: budget accounting is now race-safe. Idle-trigger invocations run through the same per-copilot queue as broadcasts (so they can no longer run concurrently and double-spend), the budget preflight now atomically reserves the estimated cost (check + hold in one step) and reconciles it on completion / releases it on failure (no leaked budget on a failed invocation), and an idle trigger can no longer fire after `deactivate()` (#219, #223, #221)
- plugin-voice: `<VoiceRecorderBar>` now guards the STT success-response JSON parse — a malformed (non-JSON) 200 body surfaces a specific `VoicePluginError` ("Invalid STT response…") via `onError` instead of throwing an opaque `SyntaxError` (#217)
- plugin-voice: `useTts` no longer lets a stale `speak()` whose `audio.play()` resolves late override a newer `speak()`/`stop()`. Each call captures its own controller and, after every await, bails when it is no longer the active call — tearing down only its own audio/blob URL/listeners instead of clobbering the newer call's state (#216)
- plugin-voice: the TTS `voice` option is now validated against a single shared enum (`alloy`/`echo`/`fable`/`onyx`/`nova`/`shimmer`) at construction, so a misconfigured default voice fails fast instead of diverging from the server's runtime check and only surfacing as a 400 on the first request. The server's per-request voice validation now derives from the same source of truth (#215)
- plugin-voice: a `MediaRecorder` error that fires while recording (with no `stop()` in flight) now always releases the media stream and is surfaced via a new `onError` recorder option, instead of being silently dropped with the microphone stream left open (#213)
- plugin-voice: the STT and TTS server handlers now bound the upstream provider call with a timeout (default 30s, configurable via `timeoutMs`) and accept a client `signal`, so a stalled provider no longer hangs the handler indefinitely — a timeout or client abort returns `504 UPSTREAM_TIMEOUT` instead. Passing the signal to the real `fetch` also cancels the TTS streamed body when the client disconnects mid-stream (#211, #212)
- plugin-realtime: concurrent `applyYjsUpdate`/`applyYjsAwareness` calls on a fresh room now share a single `Y.Doc` via an in-flight single-flight memo, fixing a check-then-act race that orphaned a duplicate `Y.Doc` (and its `Awareness`); a failed doc init clears the memo so a later call can recreate it (no permanently bricked room). The redundant second `loadYjs()` per apply is removed — `ensureYjs` now returns the loaded modules in its bundle (#193, #196)
- plugin-realtime: a room declared with `storage: "yjs"` wired to a provider that does not implement Yjs (`applyYjsUpdate`/`applyYjsAwareness`, e.g. the in-memory provider) now throws a `RealtimeError` (`yjs_provider_unsupported`) when a Yjs frame is dispatched, instead of silently dropping it and losing document state. Rooms without `storage: "yjs"` are unaffected — a stray Yjs frame is still a no-op (#197)
- plugin-db-drizzle: the studio devtools `studioUrl` is now built from the resolved `studioHost`/`studioPort` options (default `localhost:4983`) instead of a hardcoded URL, so a custom studio host/port is honored (#207)
- plugin-db-drizzle: the CLI `db`-namespace conflict guard is no longer a no-op — when the `db` namespace is already registered (e.g. by `@theokit/orm`), the plugin now warns that it is extending an existing namespace before merging its verbs, instead of both branches handling the case identically (#171)
- plugin-db-drizzle: `db seed` now runs the user's configured seed script instead of invoking a nonexistent `drizzle-kit seed` subcommand. The `seed` command is flagged `kind: "user-script"` and runs `seedScript` (settable on `drizzleDb(...)` or resolved from `package.json#theokit.db.seed`); when no script is configured it fails with a clear, actionable error (#170)
- plugin-db-drizzle: the configured `driver`/`url` connection options are now forwarded to drizzle-kit (as `--dialect`/`--url`) for the verbs that open a connection (`migrate`/`push`/`studio`/`check`) — previously they were accepted but dropped. `generate` (schema-diff only) is unaffected, and flags are omitted when their source is unset (#169)
- plugin-db-drizzle: the destructive `db reset` command is now flagged `requiresForce`, so the CLI runner refuses it unless the user passes `--force` (the documented destructive-op guard that previously did not exist) (#168)
- plugin-realtime: a subscription that is aborted mid-stream now reliably releases its connection handle and abort listener instead of leaking them — the abort listener is registered before the connection await (and an already-aborted signal is honored up front), so an abort during connection setup is no longer missed. The per-subscription frame buffer is now bounded: a consumer that cannot keep up is disconnected (close 1013) rather than letting the server buffer grow without limit, and no frames are buffered after abort (#195, #198)
- plugin-realtime: a Yjs update can no longer be applied to a destroyed/garbage-collected `Y.Doc`. In-flight applies now hold a per-room refcount that defers room teardown until they finish, so a concurrent `leaveRoom` can't destroy the doc mid-apply; an apply that races room eviction is a safe no-op. This also closes a doc leak where a room garbage-collected while its doc was still initializing left the `Y.Doc` orphaned (never destroyed) (#194)
- auth-github: a failed `/user/emails` fetch is now surfaced as a typed `GitHubAuthError` (`emails_fetch_failed`) instead of being silently swallowed into a null-email identity. This only fires when the `user:email` scope was granted and `/user` returned no email — a genuinely email-less account (endpoint OK, no verified address) still resolves to a documented null, distinct from a fetch failure (#203)
- auth-magic-link: the default email resolver caps the buffered request body (16 KB) to prevent a large-POST DoS (#204) and narrows error handling so transport/stream errors propagate instead of being swallowed (#209); the callback URL is built via the URL API (no double slash) and `magicLink()` validates `callbackBaseUrl` at construction (#205)
- plugin-payments: the Stripe client now validates `apiVersion` against the SDK's accepted set at runtime and throws `StripeApiVersionError` on an unsupported value, instead of blind-casting it past the type system — so a JS consumer can no longer silently send an unsupported version to Stripe (#210)
- plugin-payments: webhook dispatch now aggregates every failed handler's error into a single `AggregateError` (instead of throwing only the first and losing the rest to a log), and `processWebhook` returns a **sanitized** `{code,message}` error at the HTTP boundary while logging the full error server-side with secrets redacted — closing a PII/secret leak (#201) and a lost-errors gap (#208). `WebhookResult.error` shape narrowed (see changeset)
- plugin-payments: webhook events are now claimed before dispatch and **released on handler failure** so Stripe's retry re-runs a failed handler instead of silently deduping it — restoring exactly-once-on-success + retry-on-failure (previously a thrown handler left the event marked, dropping it permanently). `IdempotencyStore` gains a required `release()` and `IdempotencyRepository` a required `delete()`; webhook handlers must be idempotent (#167)
- plugin-payments: `formatAmountForStripe` now detects zero-decimal currencies from Stripe's published currency set keyed on the ISO code (not amount/locale-dependent `Intl` introspection) and scales to minor units with integer-exact arithmetic — fixing a 100x undercharge for codes like ISK/HUF/UGX, a 10x undercharge for 3-decimal currencies (BHD/KWD/…), and a binary-float rounding error (e.g. 1.005 USD). Non-finite/negative/overflowing amounts now fail loudly (#199, #200)

### Security

- plugin-db-drizzle: the studio devtools iframe no longer pairs `sandbox="allow-scripts allow-same-origin"` (which lets framed content remove its own sandbox and escape) — it now uses `sandbox="allow-scripts"` only. Studio runs on its own host:port, so same-origin was unnecessary (#206)
- plugin-copilot: untrusted room text is no longer concatenated into the agent's system prompt. User content is now passed as an isolated, fenced user-role message (marked as untrusted data, with forged fence markers stripped) while the trusted system prompt travels in its own role — mitigating prompt injection (OWASP LLM01) (#218)
- plugin-voice: the STT and TTS handlers no longer reflect the raw upstream provider error body to the client (which could leak provider internals). The body is now logged server-side under a correlation id, and the client receives a generic message with that same id for support correlation (#214)
- auth-google: the OIDC flow now refuses any non-`https` URL it would fetch — the discovery base, and the discovered `authorization_endpoint`, `token_endpoint`, and `userinfo_endpoint` — with a loopback (`localhost`/`127.0.0.0/8`/`::1`) carve-out for local test sidecars. The `MOCK_GOOGLE_OIDC_BASE_URL` test override is now honored only when it targets a loopback host, so a leaked `NODE_ENV=test` can no longer redirect the credential-bearing token exchange to an attacker, closing an SSRF that could exfiltrate `client_secret` + auth code. Note: the audit's prescribed "discovered endpoint host must equal the base host" check was deliberately **not** adopted — Google's real discovery spans `accounts.google.com`/`oauth2.googleapis.com`/`openidconnect.googleapis.com`, so host-equality would break production; the https-except-loopback rule closes the same plaintext-exfil vector without that breakage (#192)
- auth-magic-link: magic-link tokens are now hashed (SHA-256) at rest in the built-in memory and ORM stores, so a store/DB/log leak no longer exposes live credentials (#191). Also documents that magic-link tokens are intentionally unbound bearer credentials — cross-device by design — relying on token entropy + short TTL + single-use + hash-at-rest rather than OAuth `tx.state` binding (#190; supersedes plan ADR D6)
- plugin-canvas: enforce artifact security on the REST `POST /artifacts` route — script-bearing SVG and meta-refresh HTML are now rejected with 400 before persistence, closing a stored-XSS bypass that previously only guarded the agent-tool path (#176)
- plugin-canvas: the artifact security gate now also covers `image` (`data:image/svg+xml`), `mermaid`, and `slide-deck` kinds — SVG data URLs are decoded and sanitized (malformed base64 rejected cleanly), and mermaid/slide-deck sources are scanned for script vectors (#178)
- plugin-canvas: the mermaid renderer now sanitizes the rendered SVG (DOMPurify) before injecting it into the DOM, adding defense-in-depth on top of mermaid's `securityLevel:'strict'` (#177)
- plugin-canvas: the SVG sanitizer now derives its removal verdict from DOMPurify's reported removals (not an input/output regex diff) and drops the post-sanitize regex pass — fixing a false rejection of valid `https` URLs that merely contained `javascript:` in a query string, and an inaccurate `removedJsUrl` verdict (#179, #180)

## [0.1.0] - 2026-06-11

### Added

- Code review report covering all 11 packages — 166 findings across 182 files (`code-review-output/REVIEW-REPORT.md`)
- Implementation plan to remediate all 23 blocking findings (`knowledge-base/plans/fix-code-review-findings-plan.md`)
- DOMPurify-based SVG/HTML sanitization in plugin-canvas, replacing regex-based approach (OWASP recommendation)
- Resend provider test suite (`packages/plugin-email/tests/resend-provider.test.ts`)
- Budget bridge calendar-month test suite (`packages/plugin-copilot/tests/budget-bridge.test.ts`)
- Initial monorepo scaffold — `pnpm-workspace.yaml` + `tsconfig.base.json` + ESLint + Prettier + Changesets + CI workflows

### Changed

- Bump `@theokit/ui` peer dependency to `^0.14.2` in plugin-canvas, plugin-copilot, and plugin-forms
- plugin-copilot: `CopilotAgentConfig.apiKey` now accepts `string | (() => string)` for lazy key resolution
- plugin-payments: `WebhookRegistry.dispatch()` now runs all handlers even when one throws (first error rethrown, subsequent logged)
- plugin-voice README updated to reflect v0.7.0 capabilities; removed false auto-endpoint claim
- plugin-realtime README documents `useBroadcast`/`updateMyPresence` as local-only in v0.1

### Fixed

- plugin-canvas: SQL injection via unvalidated table name in `createSqliteArtifactStore` — now validated against `/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/`
- plugin-canvas: SVG sanitizer bypass vectors (foreignObject, CSS expression, case-mixed javascript: URIs, external xlink:href)
- plugin-canvas: 500 error responses no longer leak internal error messages
- plugin-canvas: `onAfterInsert` side-effect errors now logged instead of silently swallowed
- plugin-canvas: invalid `kind` query param now returns 400 instead of unchecked type assertion
- plugin-copilot: race condition in `CopilotRuntime.handleFrame` — concurrent calls now serialized per-registration
- plugin-copilot: `deactivate()` now drains pending frame queue before leaving room
- plugin-copilot: `BudgetBridge` uses calendar month boundaries instead of fixed 30-day window
- plugin-copilot: agent errors in `runAgent` now propagated to callers after broadcast
- plugin-db-drizzle: devtools iframe now sandboxed (`allow-scripts allow-same-origin`)
- plugin-email: `ResendProvider.send` preserves error cause chain from Resend API
- plugin-forms: non-`ActionInputError` exceptions in `TheoForm` `onSuccess` now rethrown
- plugin-payments: webhook handler errors no longer block subsequent handlers
- plugin-realtime: listener errors in fanout loops now logged instead of silently swallowed
- plugin-realtime: mermaid and Yjs lazy loaders use single-flight pattern (no concurrent double-init, no permanent error cache)
