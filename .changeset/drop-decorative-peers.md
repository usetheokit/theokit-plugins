---
'@theokit/plugin-canvas': patch
'@theokit/plugin-copilot': patch
'@theokit/plugin-db-drizzle': patch
'@theokit/plugin-payments': patch
'@theokit/plugin-realtime': patch
---

Seven `@theokit/*` peer dependencies that no package imported are removed.

Each appeared in the source only inside comments — several of them in comments explaining the
structural shape chosen precisely to AVOID depending on the package, and one in
`plugin-payments` stating outright that "plugin doesn't take a peerDep on a specific
@theokit/orm version". A peer nobody imports is not inert: it drags its own dependency tree into
the consumer's resolution, which is how `@theokit/plugin-forms` became impossible to install
with npm (#64).

Removed: `@theokit/sdk` from plugin-canvas and plugin-realtime, `@theokit/orm` from
plugin-db-drizzle and plugin-payments, and `@theokit/plugin-canvas`, `@theokit/plugin-voice` and
`@theokit/ui` from plugin-copilot. Nothing imported them, so no consumer code changes.
