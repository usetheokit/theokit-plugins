# Changelog

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
