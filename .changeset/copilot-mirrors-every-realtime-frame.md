---
'@theokit/plugin-copilot': patch
---

`@theokit/plugin-realtime`'s provider can now be handed to `copilot()`, which is what the peer dependency was always promising.

`CopilotFrame` is a structural mirror of `RealtimeFrame`, kept as a mirror rather than an import so this package takes no hard dependency on the other. The mirror stopped at four variants while the original grew to six: `yjs-update` and `yjs-awareness` arrived with collaborative editing and were never copied across.

A provider that can emit a frame the listener type does not cover is not assignable to it, so wiring the two together failed at `tsc` with a message about `subscribeRoom` — several layers away from the cause, and only in a consumer's app.

It drifted unnoticed because the peer was never installed here to test against. It is now, and a type assertion performs the assignment, so the next variant added upstream fails in this package instead of in your app.
