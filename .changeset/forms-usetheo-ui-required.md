---
'@theokit/plugin-forms': patch
---

`@usetheo/ui` is no longer declared an optional peer, because the package cannot load without it.

The public barrel re-exports `TheoField`, which imports `@usetheo/ui` at module scope, so a clean
install without it threw `ERR_MODULE_NOT_FOUND` on any import from the package root. The
declaration now says what the code does.

Nobody loses a working capability: the barrel has re-exported `TheoField` since the v0.1.0
scaffold, and both published versions carry `@usetheo/ui` in `dist/index.js`, so the "headless
works peer-free" path this flag promised has never existed. Making it real means a separate entry
point for the styled tier — an API change, tracked as #104.
