---
'@theokit/auth-google': patch
'@theokit/auth-magic-link': patch
'@theokit/plugin-canvas': patch
'@theokit/plugin-db-drizzle': patch
'@theokit/plugin-forms': patch
'@theokit/plugin-payments': patch
'@theokit/plugin-voice': patch
---

The README examples now use the API `theokit@0.48` exports, and every one of them was verified by compiling it rather than by reading it. Ten names they told you to import — `defineConfig`, `defineRoute`, `definePlugin`, `defineAction`, `defineAgentTool`, `defineTheoConfig`, `defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`, `useAgentStream` — exist in none of that version's 24 export subpaths. Copying the first block of most of these READMEs produced code that did not compile.

The `auth-google` and `auth-magic-link` wiring examples changed shape rather than names: the auth orchestrator takes Node's `IncomingMessage`/`ServerResponse`, and no handler surface TheoKit exposes today hands you those, so the examples show a Node server and state the gap.
