---
'@theokit/plugin-voice': minor
---

The voice endpoints as a controller your app extends, instead of two handlers it mounts.

`VoiceControllerBase` (new, from `@theokit/plugin-voice/server`) declares `POST stt` and `POST tts`
and carries the half every consumer previously wrote by hand: reading a `multipart/form-data` body
into the transcription input, and rejecting a request with no audio as a typed `MISSING_AUDIO`
instead of letting `undefined` reach the provider call.

It binds no URL prefix and no access decision — both stay yours, which is the point: you vary where
the verbs are mounted, which provider config backs them, and who may call each one, without editing
this package. `transcribe` / `synthesise` are protected seams for a per-tenant provider, a usage
counter, or a cache.

`handleSttRequest` and `handleTtsRequest` are unchanged and still supported. `@theokit/http` is an
OPTIONAL peer, loaded only by the new `./server` entry — an app that keeps using the handlers
installs nothing extra.
