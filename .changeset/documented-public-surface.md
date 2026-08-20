---
'@theokit/auth-github': patch
'@theokit/auth-google': patch
'@theokit/auth-magic-link': patch
'@theokit/plugin-canvas': patch
'@theokit/plugin-copilot': patch
'@theokit/plugin-email': patch
'@theokit/plugin-forms': patch
'@theokit/plugin-payments': patch
'@theokit/plugin-voice': patch
---

Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.
