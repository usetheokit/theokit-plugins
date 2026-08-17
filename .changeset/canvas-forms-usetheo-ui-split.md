---
'@theokit/plugin-canvas': minor
'@theokit/plugin-forms': minor
---

Migrate the generic UI primitives to `@usetheo/ui`, completing the `@theokit/ui` v1 split.

`@theokit/ui@1.0.0` moved its 54 non-AI components to `@usetheo/ui` and became AI-exclusive. These two packages never ran that migration, so they kept importing `Alert`, `Button`, `CodeBlock`, `CopyButton`, `DropdownMenu`, `FormField` and `Tooltip` from `@theokit/ui`, where those symbols no longer exist. Both were published broken: importing `@theokit/plugin-canvas/ui` or `<TheoField>` failed to resolve, and the workspace had `typecheck` (10 errors), `build` (DTS) and 4 test suites red.

`DiffViewer` stays on `@theokit/ui` — it is an AI component and did not move.

**Action required:** install `@usetheo/ui` (`>=0.22.0 <1`) alongside `@theokit/ui`. It is a required peer of `@theokit/plugin-canvas` and an optional one of `@theokit/plugin-forms` (only the styled `<TheoField>` tier needs it; the `useTheoField()` headless hook stays peer-free).
