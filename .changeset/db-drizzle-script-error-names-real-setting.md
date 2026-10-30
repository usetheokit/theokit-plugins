---
'@theokit/plugin-db-drizzle': patch
---

The `seed` and `reset` error for a missing script names only the setting the package reads (#231)

With no `seedScript` (or `resetScript`), `buildArgs()` threw "Set `seedScript` on drizzleDb(...) or
`package.json#theokit.db.seed`". Nothing in the package reads `package.json`, so following the second
half of the message produced the same error. The message and the `seed` command summary now point
only at `drizzleDb({ seedScript })` and `drizzleDb({ resetScript })`.
