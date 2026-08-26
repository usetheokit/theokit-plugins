---
"@theokit/plugin-canvas": minor
---

Adds `ArtifactsControllerBase`, exported from `@theokit/plugin-canvas/server` — the artifact endpoints as a controller your app extends, instead of handlers it mounts by hand. The plugin declares the verbs and keeps the behaviour behind them in one place; your app supplies the URL, the store, and the access decision per verb. `createArtifactRouteHandlers` is unchanged and still supported.
