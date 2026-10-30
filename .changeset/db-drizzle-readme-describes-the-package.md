---
'@theokit/plugin-db-drizzle': patch
---

The README describes the package that ships, and the unused `reflect-metadata` peer is gone (#226)

**Removed the `reflect-metadata` peer dependency.** Nothing in this package imports it. It was
declared for `@theokit/orm` entity decorators, and this package does not use `@theokit/orm`. If
your app needs the polyfill for its own entities, keep it in your own `package.json`; npm and pnpm
no longer ask for it on behalf of this plugin.

**The README no longer claims things the package does not do.** Removed: `@theokit/orm` as a
required peer, the sentence saying the plugin re-exports orm's Repository surface, and the
"Migration from `@theokit/orm`" block, whose `OrmModule.forRoot({ connector, url })` call throws in
`@theokit/orm@0.2.1`. The license line now says Apache-2.0, as `package.json` does, and the stale
"v0.1.0 on the `@next` tag" status is gone.

The README now says what the package does: `drizzleDb(...)` resolves options, `register()` is
empty, and `buildDbCommands`, `renderDrizzleConfig` and `buildDevtoolsTab` feed a script you own.
Its `scripts/db.ts` example now honours each command's `kind`. The previous one ran every verb
through `drizzle-kit`, which fails for `seed` and `reset` (drizzle-kit has neither) and for
`migrate` and `studio` without the generated config. It also says that the
`theokit db migrate | generate | seed` commands in the TheoKit CLI are TheoKit's and do not use
this plugin.

The npm description and the docblocks in the published types made the same claims (orm wrapping,
a `theokit db` CLI, a devtools tab registered for you) and were corrected the same way. No runtime
code changed.
