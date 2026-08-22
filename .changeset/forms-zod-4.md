---
'@theokit/plugin-forms': minor
---

The `zod` peer is `^4.0.0`, and the package is developed and tested against zod 4.

It advertised `^3.25.0 || ^4.0.0` while its own peer chain forbids zod 3: `@theokit/react` requires
`@theokit/sdk@^1.1.0`, and `@theokit/sdk@1.9.0` requires `zod@^4.0.0`. The repository meanwhile
built and tested the package against `zod@3.25.76`, so the version tested was not a version a
consumer can install. Both halves are now the same version.

This does not on its own make `npm install @theokit/plugin-forms` succeed — see #64.
