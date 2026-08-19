---
'@theokit/plugin-forms': patch
---

Drop the `theokit` and `@theokit/ui` peer dependencies, and document that `zod@^4` must be
named at install time.

Neither peer was imported by `src/`. The `theokit` one was not merely decorative: it pulled
`theokit@0.48.13`, whose optional peer on `@theokit/sdk@^4.52.1` collides with the
`@theokit/sdk@^1.1.0` that `@theokit/react@1.1.0` requires — an unsatisfiable tree that
`npm install` refuses even when the consumer pins zod.

A default `npm install` still fails, for a cause outside this package: `@hookform/resolvers`
reaches `@typeschema/zod@0.14.0` (`zod@^3.23.8`) while `@theokit/react@1.1.0` reaches
`@theokit/sdk@1.9.0` (`zod@^4.0.0`). Naming `zod@^4` at the root resolves it, and the README
carries the chain plus the reason it is not fixable here.
