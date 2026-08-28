---
'@theokit/plugin-voice': minor
'@theokit/plugin-canvas': minor
---

Declare `zod` as a peer dependency on `^4.0.0` instead of bundling `^3.24.0`.

Both packages export a schema for `@theokit/http`'s `@Body()` — `ttsInputSchema` and
`artifactSchema` — and `@Body` is typed against zod 4. Bundling zod as a direct dependency put a
second copy in every consumer's tree, and the published `.d.ts` resolved its bare `import { z } from
'zod'` to that copy, so the schema was typed against a zod the decorator does not accept. The
pattern each package's own JSDoc prescribes did not compile in any consumer.

Migrating exposed a behaviour change worth naming on its own: in zod 4, `.default({})` is applied
after the sub-schema parses, so `plugin-voice` returned `{ stt: {}, tts: {} }` with no provider,
model or endpoint. That is not a compile error; the fields the package treats as always-present were
simply missing. The schema now uses `.prefault({})`, which restores the zod 3 semantics.

Marked minor rather than patch: the peer range no longer accepts zod 3, so a consumer on that line
must move. Nothing in either package's own API changed.
