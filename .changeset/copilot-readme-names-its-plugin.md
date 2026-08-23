---
'@theokit/plugin-copilot': patch
---

Document the plugin this package is. The README's Quick start now registers `copilot()` in
`theo.config.ts` before defining a copilot, and the npm description names the plugin rather than
only `defineCopilot`.

Measured before the change: `copilot(`, `plugins:` and `theo.config` appeared zero times in the
README. A developer following it exported a `defineCopilot` and stopped — the plugin was never
registered, `ctx.copilot` was never decorated, and nothing failed, because an unregistered plugin
is indistinguishable from a plugin nobody wrote.
