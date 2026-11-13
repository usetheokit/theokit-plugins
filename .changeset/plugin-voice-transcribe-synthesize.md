---
'@theokit/plugin-voice': minor
---

Export `transcribe()` and `synthesize()`, plain functions that return the transcript string and the audio bytes. They throw `VoiceInputError` (new) for invalid input and `VoiceProviderError` with a `code` for upstream failures. `handleSttRequest` and `handleTtsRequest` now wrap them with unchanged responses.
