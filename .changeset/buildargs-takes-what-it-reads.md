---
'@theokit/plugin-db-drizzle': minor
---

`DbCommand.buildArgs()` takes no argument, the documented wiring names where its options come from, and the published types no longer cite issues that belong to other work.

**`buildArgs` declared a parameter it never read.** The interface said `buildArgs(opts: ResolvedDrizzleDbOptions)`; the implementation was a zero-argument closure over the options handed to `buildDbCommands`. So the argument was accepted and discarded — measured by building one command from a sqlite config and calling `buildArgs` three ways:

```
passing a DIFFERENT resolved config (postgresql, ./OTHER.ts)
  → ["generate","--dialect","sqlite","--schema","./s.ts", …]
passing {}       → identical
passing nothing  → identical
```

The dialect stayed `sqlite` when handed postgres. A caller who resolved their config twice and passed the fresh copy got an argv built from the first, with nothing reporting the drop.

**To upgrade:** delete the argument. `cmd.buildArgs(resolved)` becomes `cmd.buildArgs()`. This is a compile error rather than a silent change, which is the point — that argument has never had an effect, and the error is how you find out. Nothing that runs today changes behaviour.

**Where the options for `buildDbCommands` come from is now written down.** It takes the RESOLVED shape — ten required fields, no optionals — and a hand-written object short by one field does not fail: it builds `["migrate", "--config", undefined]`, a slot holding the JS value `undefined`. `drizzleDb(...).options` is the only thing that fills the defaults, so it is the only honest source, and a test pins both halves: every verb built the documented way carries a complete argv, and the short object produces exactly that hole.

**Five fabricated issue citations are gone from the published types.** `dist/index.d.ts` — what an editor shows on hover — cited `#170`, `#168`, `#169`, `#206` and `#207` for subjects those numbers do not describe; two of them did not exist in any repo. The reasoning in each docblock stands without the link, so the number is dropped and the sentence kept, except where `#48` genuinely covers it.
