---
'@theokit/auth-github': minor
'@theokit/auth-google': minor
'@theokit/auth-magic-link': minor
'@theokit/plugin-copilot': minor
---

Requires `@theokit/sdk@4.54.0` or newer, and the auth READMEs name the API that exists.

All three auth READMEs opened with `import { defineAuth } from '@theokit/sdk/server/auth'`. That function shipped in sdk 2.x and is gone from 4.x, which is what npm serves — so a reader copying the first example imported something that does not exist. The orchestrator is now `Auth.create`, and the options are unchanged.

Nothing here caught it because these packages tested against `@theokit/sdk@^2.18.0` — a caret on a 2.x version, so two majors behind what a consumer installs. The doc gate that type-checks README examples was checking them against a version nobody has. It now checks against 4.54.0, and that is what surfaced this.

`@theokit/plugin-copilot` gains a fix of its own: `CopilotAgentLike` could not be satisfied by any real agent. It declared `streamObject<T>(opts: { schema: unknown })` and promised `DeepPartial<T>` out — a `T` no parameter determined — so `@theokit/sdk`'s `Agent`, the only agent this ecosystem ships, was not assignable while the README invited exactly that wiring. It is now parameterised on the schema, as the SDK does.

The same package's `CopilotFrame` also mirrors every `RealtimeFrame` variant again: `yjs-update` and `yjs-awareness` arrived upstream with collaborative editing and were never copied, which made `@theokit/plugin-realtime`'s provider — a declared peer — unassignable.

If you are on `@theokit/sdk@2.x` or `3.x`, the previous release of these packages still installs.
