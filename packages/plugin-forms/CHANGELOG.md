# Changelog

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
