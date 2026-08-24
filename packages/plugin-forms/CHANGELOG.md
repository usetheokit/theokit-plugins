# Changelog

## 0.4.0

### Minor Changes

- 8b0aa9b: File uploads work. `<TheoForm encType="multipart/form-data">` converts the form's values to the
  `FormData` shape the framework reconstructs.

  The README said "No file uploads in v0.1", and measurement refuted the framing twice. The file
  always reached the action — `TheoField` renders no input of its own, and `useAction` does not
  serialise. And the rest of the stack already did multipart end to end: the client invoker sends a
  `FormData` body untouched, and an action declaring `accept: 'form'` reconstructs an object from it
  guided by the Zod schema. What was missing was one conversion in this package.

  It is a shipped function rather than a documented snippet because the convention is not the obvious
  one: dot notation for nesting, and **repeated keys** for arrays. A hand-rolled walk produces
  `tags[0]`/`tags[1]`, which the other side does not find — the field arrives empty with no error
  anywhere.

  Two things to know when you use it:
  - Write `z.array(z.instanceof(File))`, even for a single file. A registered file input holds a
    `FileList`, which this package now normalises to `File[]` before validation — previously the
    natural schema failed client-side and the submit never happened.
  - Your action must declare `accept: 'form'` server-side. That is where the body is parsed and this
    package cannot see it.

  Also: `encType` is now a real prop. It was hardcoded `application/x-www-form-urlencoded` on every
  form — the attribute a reader inspects to answer exactly this question, answering it wrongly.

  Known limitation, pinned by a test: a multipart **scalar** array collapses to its last element
  (`['a','b']` arrives as `['b']`). The cause is in the framework's body parser, upstream of anything
  this package controls. Arrays of files are unaffected.

### Patch Changes

- 410c1ad: The README described a headless tier that cannot be reached. It now describes what the package does.

  `@usetheo/ui` was listed as **optional** while `package.json` declares it a required peer, and the
  "Gotchas" section said `<TheoField>` _"throws at first render … not at module import"_. Measured
  against a real consumer layout, neither holds:

  ```
  import('@theokit/plugin-forms')        -> ERR_MODULE_NOT_FOUND: Cannot find package '@usetheo/ui'
  import('@theokit/plugin-forms/react')  -> ERR_PACKAGE_PATH_NOT_EXPORTED
  ```

  The package declares exactly one export, and the barrel reaches `<TheoField>`, which imports
  `@usetheo/ui` at module scope. So the failure happens when the module graph loads. `useTheoField` is
  not an escape hatch from it — there is no second entry point to reach.

  **No behaviour changed.** What changed is that the documentation says so, the version range matches
  the manifest, and a consumer test pins it, so the day a headless entry point exists the test fails
  and asks to be updated.

  Why one was not added here: `<TheoForm>` imports `<TheoField>` to build the `TheoForm.Field`
  compound, so the barrel reaches it either way, and `splitting: false` would duplicate
  `TheoFormContext` and hand a consumer two React contexts — which is what reverted the earlier
  attempt. Whether to build one anyway is a decision about the published surface, and it is recorded
  rather than made.

## 0.3.0

### Minor Changes

- a154a82: `@hookform/resolvers` moves from `peerDependencies` to `dependencies`, which makes
  `npm install @theokit/plugin-forms` succeed.

  It was never a consumer contract: `TheoForm` imports `zodResolver` from
  `@hookform/resolvers/zod` internally and the consumer never names the package. As a peer it sat
  in the consumer's top-level resolution, where npm eagerly satisfies its OPTIONAL peer
  `@typeschema/main` — and `@typeschema/zod` pins `zod@^3.23.8` while `@theokit/sdk` requires
  `zod@^4.0.0`. Two transitive chains, mutually exclusive, neither of them ours. As a dependency it
  resolves inside this package's own subtree and the conflict does not arise.

  `react-hook-form` stays a peer, correctly: the consumer holds that instance and passes it around.

- b187501: The `zod` peer is `^4.0.0`, and the package is developed and tested against zod 4.

  It advertised `^3.25.0 || ^4.0.0` while its own peer chain forbids zod 3: `@theokit/react` requires
  `@theokit/sdk@^1.1.0`, and `@theokit/sdk@1.9.0` requires `zod@^4.0.0`. The repository meanwhile
  built and tested the package against `zod@3.25.76`, so the version tested was not a version a
  consumer can install. Both halves are now the same version.

  This does not on its own make `npm install @theokit/plugin-forms` succeed — see #64.

### Patch Changes

- 76ef4ce: The README's Cookbook 1 produced an inaccessible form; it now produces an accessible one.

  `FormField.Control` clones its DIRECT child to inject `id`, `aria-invalid` and
  `aria-describedby`, and the example put a consumer component in that slot, which received those
  props and dropped them: the label pointed at an id nothing had, and the invalid state was never
  announced (#105). `FormField.Error` renders its children and reads nothing on its own, so the
  self-closing `<FormField.Error />` showed an empty alert while the server's reason was discarded
  (#106).

  Documentation only — no runtime change. Both shapes are now pinned by tests that assert the
  accessible relationships rather than the markup.

- 2369e29: `@usetheo/ui` is no longer declared an optional peer, because the package cannot load without it.

  The public barrel re-exports `TheoField`, which imports `@usetheo/ui` at module scope, so a clean
  install without it threw `ERR_MODULE_NOT_FOUND` on any import from the package root. The
  declaration now says what the code does.

  Nobody loses a working capability: the barrel has re-exported `TheoField` since the v0.1.0
  scaffold, and both published versions carry `@usetheo/ui` in `dist/index.js`, so the "headless
  works peer-free" path this flag promised has never existed. Making it real means a separate entry
  point for the styled tier — an API change, tracked as #104.

## 0.2.3

### Patch Changes

- 03b1b5d: Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

  Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

  Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.

- 65555ad: Drop the `theokit` and `@theokit/ui` peer dependencies, and document that `zod@^4` must be
  named at install time.

  Neither peer was imported by `src/`. The `theokit` one was not merely decorative: it pulled
  `theokit@0.48.13`, whose optional peer on `@theokit/sdk@^4.52.1` collides with the
  `@theokit/sdk@^1.1.0` that `@theokit/react@1.1.0` requires — an unsatisfiable tree that
  `npm install` refuses even when the consumer pins zod.

  A default `npm install` still fails, for a cause outside this package: `@hookform/resolvers`
  reaches `@typeschema/zod@0.14.0` (`zod@^3.23.8`) while `@theokit/react@1.1.0` reaches
  `@theokit/sdk@1.9.0` (`zod@^4.0.0`). Naming `zod@^4` at the root resolves it, and the README
  carries the chain plus the reason it is not fixable here.

- bfa7409: The README examples now use the API `theokit@0.48` exports, and every one of them was verified by compiling it rather than by reading it. Ten names they told you to import — `defineConfig`, `defineRoute`, `definePlugin`, `defineAction`, `defineAgentTool`, `defineTheoConfig`, `defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`, `useAgentStream` — exist in none of that version's 24 export subpaths. Copying the first block of most of these READMEs produced code that did not compile.

  The `auth-google` and `auth-magic-link` wiring examples changed shape rather than names: the auth orchestrator takes Node's `IncomingMessage`/`ServerResponse`, and no handler surface TheoKit exposes today hands you those, so the examples show a Node server and state the gap.

## 0.2.2

### Patch Changes

- 0561310: `applyActionErrorsToForm(form.setError, …)` voltou a compilar (#54).

  O uso documentado não passava no TypeScript: `SetErrorCallback` declarava `name: string` e o
  `setError` do react-hook-form aceita uma união estreita dos caminhos do formulário — por
  contravariância de parâmetro, a função mais estreita não é atribuível onde se espera a mais larga.
  Runtime sempre funcionou; só os tipos não compunham.

  `SetErrorCallback` é genérico sobre o nome agora, com default `string`, então **nenhum uso existente
  quebra**. O cast inevitável entre a chave que vem do servidor em runtime e o tipo que o formulário
  conhece em compilação passou a viver dentro do plugin, uma única vez, em vez de em cada chamada.

## 0.2.1

### Patch Changes

- e9ca941: O erro de um server action passou a ser verificado até o campo que o produziu.

  O teste de integração anterior fazia a metade do transporte com servidor e fetch reais, mas passava
  `vi.fn()` como `setError` — provava que o adapter invoca um callback, não que um formulário real
  mostra alguma coisa. O novo liga tudo: 422 real → fetch → adapter → react-hook-form real →
  `useTheoField(nome).isInvalid`.

  Cobre a chave aninhada `address.city` (onde o adapter aposta numa afirmação sobre o RHF que ninguém
  tinha checado), a convenção `''` → `root`, e a recuperação do usuário. Somente testes.

  Ao escrever, ficou visível que `applyActionErrorsToForm(form.setError, …)` — o uso documentado — não
  compila por contravariância de parâmetro; registrado como #54, sem mudança de tipo público aqui.

## 0.2.0

### Minor Changes

- f67e21e: Migrate the generic UI primitives to `@usetheo/ui`, completing the `@theokit/ui` v1 split.

  `@theokit/ui@1.0.0` moved its 54 non-AI components to `@usetheo/ui` and became AI-exclusive. These two packages never ran that migration, so they kept importing `Alert`, `Button`, `CodeBlock`, `CopyButton`, `DropdownMenu`, `FormField` and `Tooltip` from `@theokit/ui`, where those symbols no longer exist. Both were published broken: importing `@theokit/plugin-canvas/ui` or `<TheoField>` failed to resolve, and the workspace had `typecheck` (10 errors), `build` (DTS) and 4 test suites red.

  `DiffViewer` stays on `@theokit/ui` — it is an AI component and did not move.

  **Action required:** install `@usetheo/ui` (`>=0.22.0 <1`) alongside `@theokit/ui`. It is a required peer of `@theokit/plugin-canvas` and an optional one of `@theokit/plugin-forms` (only the styled `<TheoField>` tier needs it; the `useTheoField()` headless hook stays peer-free).

## 0.1.4

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.

## 0.1.3

### Patch Changes

- 9c99e77: Extract `TheoForm`'s error routing into exported pure helpers — `extractFieldsFromError` and `routeActionError` — so it can be unit-tested against the single source the component actually uses (#227). Previously the test duplicated the catch-block logic, so it could pass even if the component diverged. `TheoForm`'s behavior is unchanged (ActionInputError `fields` → RHF `setError`; any other error re-thrown). Additive exports.

All notable changes to `@theokit/plugin-forms` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-06-03 (hotfix — cross-package FormField Context dedup)

### Fixed

- **`<TheoField>` crashed `/memory` page with "FormField subcomponents must be inside <FormField>."** at runtime. Root cause: plugin imported `FormField` via sub-path `@theokit/ui/form-field` (raw chunk served by Vite), while consumer apps typically import `FormField` via main barrel `@theokit/ui` (Vite-optimized bundle). The two import paths produce TWO distinct `FormFieldContext` instances at runtime; `useFormField()` inside the consumer's `<FormField.Control>` reads `null` from the plugin's `<FormField>` provider and throws.
- Fix: switch plugin's import from `@theokit/ui/form-field` → `@theokit/ui` (main barrel). Both plugin and consumer now share Vite's optimized chunk; single `FormFieldContext` instance.
- Discovered via `/dogfood-app full` Phase 4-35 (visual /memory page render with Chrome MCP). Previous unit tests didn't catch it because vitest happy-dom uses a single React module + no Vite optimizeDeps bundling.

## [0.1.1] - 2026-06-03

### Fixed

- `<TheoField>` browser compat: replaced `(globalThis as any).require?.(...)` lazy
  load with a static ESM import from `@theokit/ui/form-field`. The previous
  approach always failed at render (browser ESM has no `globalThis.require`),
  effectively making the styled tier unusable in v0.1.0. The fix changes the
  failure mode from "render-time throw" to "import-time module resolution
  error" when `@theokit/ui` is missing — clearer and tree-shakeable.
- Consumers without `@theokit/ui`: continue using `useTheoField()` headless hook
  (works peer-free, as documented in README cookbook 3).

## [0.1.0] - 2026-06-03

### Added

- Initial scaffold — package.json with peer-deps (react>=19, react-hook-form^7.50, @hookform/resolvers^5, zod ^3.25 || ^4, theokit>=0.2.3, @theokit/react>=1.1.0; optional @theokit/ui>=0.13.0).
