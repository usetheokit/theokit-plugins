---
"@theokit/plugin-voice": patch
---

Fix boot-time crash under `@theokit/sdk` M31: `voicePlugin()` no longer imports the
removed `defineTheoPlugin` value from the deprecated `theokit/server` umbrella — it
returns a `TheoPlugin`-typed object directly (the old wrapper was a pure identity, so
behavior is unchanged). Server-only handlers (`stt-server`, `tts-server`) moved to
`src/server/` (internal only — no public subpath change), and the `fetchImpl` seam is
typed to the exact subset the handlers use (`globalThis.fetch` is still assignable).
