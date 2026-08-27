# Changelog

## 0.7.1

### Patch Changes

- Raise the `@theokit/http` peer floor from `>=1.1.0` to `>=1.1.1`.

  `1.1.0` is deprecated on npm, and for a reason that matters to anyone who has to answer a licence question: it was published carrying `license: MIT` while the repository licenses the code under Apache-2.0. The deprecation message says `Use >=1.1.1`.

  A range whose floor is that version means a consumer resolving to the bottom installs a package whose recorded licence contradicts its source. Nothing breaks at runtime — which is exactly why it would have gone unnoticed until an audit asked.

  Found by the dependency gate's floor check, which installs the bottom of every declared range rather than the version a lockfile happens to hold.

## 0.7.0

### Minor Changes

- a671794: Adds `ArtifactsControllerBase`, exported from `@theokit/plugin-canvas/server` — the artifact endpoints as a controller your app extends, instead of handlers it mounts by hand. The plugin declares the verbs and keeps the behaviour behind them in one place; your app supplies the URL, the store, and the access decision per verb. `createArtifactRouteHandlers` is unchanged and still supported.

## 0.6.0

### Minor Changes

- a76d961: Requires `theokit@0.50.1` or newer, and the README examples now declare a route policy.

  TheoKit 0.50.0 made `.policy()` mandatory on every route: a route without one fails `theokit build`, so that "who may call this" is a decision somebody wrote rather than a default nobody read. The `route()` examples in four of these READMEs predated that and had no policy — a reader who copied one got a build failure from our own documentation.

  Every example now declares its policy and says why it is the right one. For the auth packages that is `public`, because a visitor arrives without a session and signing in is what gives them one; for the payments webhook it is `public` because the gateway holds no session of ours and the signature is the authentication.

  The peer floor moves from `>=0.48.7` to `>=0.50.1` for the same reason it moved in the tests: these packages are built, tested and documented against 0.50.1 and against nothing older. The previous range admitted versions nobody here verifies. If you are on `theokit@0.48.x`, the previous release of these packages still installs.

## 0.5.0

### Minor Changes

- f6de463: Framework peer ranges describe the version each package is built against.

  `@theokit/sdk` was declared `>=2.18.0` — unbounded — on the four packages that import it, while
  the published SDK is 4.53.1 and their devDependency pins `^2.18.0`. A consumer on the current SDK
  satisfied the peer, installed without a warning, and received code compiled two majors earlier.
  Narrowed to `^2.18.0`.

  `plugin-canvas` declared `@theokit/ui: ^1.1.0` while building against `^1.3.2`; narrowed to
  `^1.3.2`. No live break there — `DiffViewer` is exported from 1.1.0 — but the range promised
  versions nothing compiles against.

- f71f9bc: The `theokit` peer floor is `>=0.48.7`, the version these packages are actually built against.

  The declared floors ranged from `>=0.1.0-alpha.5` to `>=0.4.0-beta.0` while every one of these
  packages carries `theokit: ^0.48.7` as its devDependency. Those ranges span the framework's move
  from `defineRoute({...})`-style functions to builders, so they admitted versions the code does not
  compile against — and the failure would land in a consumer's build, pointing at our package.

  Two of the old floors were pre-release versions, which promised compatibility with a version the
  framework itself did not consider stable.

  Widening a floor again is welcome, and now has a price: a CI job that builds the package against
  the version being claimed. `check:manifests` fails when a peer floor drops below the
  devDependency the package is built with.

### Patch Changes

- 46b22c8: Seven `@theokit/*` peer dependencies that no package imported are removed.

  Each appeared in the source only inside comments — several of them in comments explaining the
  structural shape chosen precisely to AVOID depending on the package, and one in
  `plugin-payments` stating outright that "plugin doesn't take a peerDep on a specific
  @theokit/orm version". A peer nobody imports is not inert: it drags its own dependency tree into
  the consumer's resolution, which is how `@theokit/plugin-forms` became impossible to install
  with npm (#64).

  Removed: `@theokit/sdk` from plugin-canvas and plugin-realtime, `@theokit/orm` from
  plugin-db-drizzle and plugin-payments, and `@theokit/plugin-canvas`, `@theokit/plugin-voice` and
  `@theokit/ui` from plugin-copilot. Nothing imported them, so no consumer code changes.

## 0.4.2

### Patch Changes

- 03b1b5d: Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

  Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

  Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.

- bfa7409: The README examples now use the API `theokit@0.48` exports, and every one of them was verified by compiling it rather than by reading it. Ten names they told you to import — `defineConfig`, `defineRoute`, `definePlugin`, `defineAction`, `defineAgentTool`, `defineTheoConfig`, `defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`, `useAgentStream` — exist in none of that version's 24 export subpaths. Copying the first block of most of these READMEs produced code that did not compile.

  The `auth-google` and `auth-magic-link` wiring examples changed shape rather than names: the auth orchestrator takes Node's `IncomingMessage`/`ServerResponse`, and no handler surface TheoKit exposes today hands you those, so the examples show a Node server and state the gap.

## 0.4.1

### Patch Changes

- e9ca941: O `createSqliteArtifactStore` passou a ser testado contra um SQLite real.

  A cobertura anterior eram 5 casos de validação de nome de tabela contra `{} as db`, então nenhum SQL
  era executado e `autoMigrate` nunca rodava — o pacote publicava um store SQLite sem nunca ter rodado
  um.

  O novo teste é de conformidade: a mesma sequência passa pelo store SQLite e pelo em memória, e os dois
  têm que concordar. Cobre round-trip por kind (cada um carrega um campo de payload diferente), ordem de
  versões, delete por versão, o caminho de linha corrompida fora de banda, e que um nome de tabela
  customizado é de fato usado.

  Somente testes; nenhuma mudança de comportamento no pacote.

## 0.4.0

### Minor Changes

- f67e21e: Migrate the generic UI primitives to `@usetheo/ui`, completing the `@theokit/ui` v1 split.

  `@theokit/ui@1.0.0` moved its 54 non-AI components to `@usetheo/ui` and became AI-exclusive. These two packages never ran that migration, so they kept importing `Alert`, `Button`, `CodeBlock`, `CopyButton`, `DropdownMenu`, `FormField` and `Tooltip` from `@theokit/ui`, where those symbols no longer exist. Both were published broken: importing `@theokit/plugin-canvas/ui` or `<TheoField>` failed to resolve, and the workspace had `typecheck` (10 errors), `build` (DTS) and 4 test suites red.

  `DiffViewer` stays on `@theokit/ui` — it is an AI component and did not move.

  **Action required:** install `@usetheo/ui` (`>=0.22.0 <1`) alongside `@theokit/ui`. It is a required peer of `@theokit/plugin-canvas` and an optional one of `@theokit/plugin-forms` (only the styled `<TheoField>` tier needs it; the `useTheoField()` headless hook stays peer-free).

## 0.3.3

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.

## 0.3.2

### Patch Changes

- de5df40: Break the `canvas-panel` ↔ `canvas-toolbar` circular dependency by extracting the shared
  `CanvasPanelToolbarAction` union into a leaf module (`ui/canvas-panel-actions`). The public
  `@theokit/plugin-canvas/ui` export surface is unchanged. Also removed a dead `?? 'h1'`
  fallback in the markdown renderer (the template literal is never nullish).

## 0.3.1

### Patch Changes

- d173838: Harden the HTML `srcdoc` security verdict (review findings F-arch-1, F-sec-1). `sanitizeHtmlSrcdoc` previously decided whether to flag a meta-refresh with a regex that only matched a **quoted** `http-equiv`, so an unquoted `<meta http-equiv=refresh>` bypassed `enforceArtifactSecurity` and the artifact passed as clean. The verdict now derives from what DOMPurify actually removed — parsed as a whole document (the way a browser renders an iframe `srcdoc`, hoisting `<meta>` into `<head>` where the refresh fires) — and folds every dangerous-removal signal (meta-refresh, iframe, object, embed, on-handler, `javascript:`/`data:` URLs) into the `removedScript` flag the boundary checks. No public API change.
- d9a8e30: Align the plugin cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from the stale 1.x ranges (`>=1.6.0` / `>=1.0.0` / `>=1.7.0` / `npm:@theokit/sdk@next`) to `^2.18.0` / `>=2.18.0`. The consumed surface (`AuthProvider` / `AuthResult` / `OAuthTransaction` from `@theokit/sdk/server/auth`; `subscribe` for realtime) is stable across 1.x→2.x, so the alignment is a pin bump, not a migration. Also removed the phantom `@theokit/plugin-rate-limit` peer dependency from `plugin-copilot` (no such package exists; its rate-limit config is a type-only opt-in — `no-stubs-no-mocks-no-wired` clean). Validated: all 11 packages typecheck + build + test green against 2.18.0 (661 tests).
- 342239f: Reduce the cyclomatic complexity of eight audit-flagged functions (CC 16–24) by extracting behavior-preserving named helpers (#182–#189). No behavior change and no public API change — all existing tests stay green. Touched: `github()`'s callback (auth-github); `createInMemoryArtifactStore`, `serializeArtifactForCopy`, and `classifyRemoved` (plugin-canvas); `defineCopilot` (plugin-copilot); the realtime subscription effect (plugin-realtime); and `handleSttRequest`/`handleTtsRequest` (plugin-voice). Six functions now measure CC ≤ 10; `serializeArtifactForCopy` (a 9-kind discriminated-union exhaustive switch) and the in-memory `memList` sit at the idiomatic floor — `lizard`'s TypeScript parser mis-merges their adjacent module helpers into one range, overstating the per-function number, but each real function is ≤ 10.

All notable changes to `@theokit/plugin-canvas` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-31

> First GA release of the canvas plugin. Promotes `0.3.0-next.0` to stable. The BREAKING change against `@theokit/ui >= 0.13.0` listed below was already shipped in `0.3.0-next.0`; no further API changes.

### Added

- `createArtifactBus()` exported from `@theokit/plugin-canvas/server` subpath — process-local pub/sub for SSE-driven artifact emit. Replaces ad-hoc bus wiring in consumer apps (canvas-ecosystem-refactor-plan T3.1)
- Server subpath `@theokit/plugin-canvas/server` — first server-side entrypoint, paving the way for additional server helpers (cost adapters, route presets) in future versions

### Changed

- **BREAKING:** `@theokit/ui` is now a **required** peer dependency (`>= 0.13.0`). Previously optional. Plugin UI components (CanvasPanel, OpenInCanvasButton, ArtifactVersionRail, code/diff/mermaid renderers) now consume `Button`, `Card`, `CopyButton`, `EmptyState`, `ScrollArea`, `Tooltip`, `Alert`, `DropdownMenu`, `CodeBlock`, `DiffViewer` primitives directly instead of raw HTML elements (D1 of canvas-ecosystem-refactor-plan)
- Plugin UI now inherits design tokens, theming, focus rings, and a11y from `@theokit/ui` — no more divergent button styles between plugin and host app
- `OpenInCanvasButton` keyboard nav improved — Radix `DropdownMenu` adds arrow-key navigation, Esc-to-close, and focus trap for free
- `CodeArtifact` now renders via `CodeBlock` composite (syntax highlighting via Shiki) for non-terminal code; terminal code keeps raw `<pre>` for unstyled monospace output
- `DiffArtifact` now delegates to `DiffViewer` primitive
- `MermaidArtifact` fallback now uses `CodeBlock` (language="mermaid") instead of raw `<pre>`

### Fixed

- N/A

## [0.2.0] - 2026-05-30

### Added

- Initial release — 9 artifact kinds (markdown/code/svg/diff/whiteboard-scene/slide-deck/mermaid/html/image), SQLite + in-memory artifact stores, `defineArtifactTool` agent helper, `CanvasPanel` + `ArtifactRenderer` + `useCanvas` hook
- Lazy peer imports for `@theokit/ui/whiteboard` and `@theokit/ui/slide-deck`
- Defense-in-depth security: schema-level byte caps + render-time SVG/HTML sanitization
