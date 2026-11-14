# @theokit/plugin-voice

Voice (Speech-to-Text + Text-to-Speech) plugin for [TheoKit](https://github.com/usetheokit/theokit).

> **Status:** 0.7.0 — STT handler, TTS handler, and UI components (`VoiceRecorderBar`, `TalkOptions`, `Alert`, `useTts`) are shipped. The OpenAI path is exercised against the live API on every nightly run, including a TTS→STT round trip; the Groq STT backend is covered only when a `GROQ_API_KEY` is present.

## Why this plugin

- Same single-config pattern as the other first-party plugins (e.g. [`@theokit/plugin-forms`](../plugin-forms/)) — install it, register it once in `theo.config.ts`. Endpoint registration is **not** automatic; wire each endpoint with `route()` from `theokit/server/define` in your `server/routes/` directory (e.g., a route that calls `handleSttRequest` / `handleTtsRequest`).
- Browser-side `MediaRecorder` helper that throws typed errors instead of `DOMException` — so `<VoiceRecorderBar>` can render an actionable `<Alert kind="auth">` when the user denied the mic.
- Provider-agnostic STT (OpenAI Whisper or Groq Whisper) selected via env var.
- Synchronous config validation: missing `OPENAI_API_KEY` throws `VoicePluginConfigError` at boot, not on the first user click.

## Install

```sh
pnpm add @theokit/plugin-voice
```

Peer dependencies:

| Peer      | Required          | Notes                         |
| --------- | ----------------- | ----------------------------- | -------- | --------------------------- |
| `theokit` | `>=0.1.0-alpha.5` | Server-side hook registration |
| `react`   | `^18.0.0          |                               | ^19.0.0` | Only for the `./ui` subpath |

## Configuration

```ts
// theo.config.ts
import voicePlugin from '@theokit/plugin-voice'
import { config } from 'theokit'

export default config()
  .set({
    plugins: [
      voicePlugin({
        stt: { provider: 'openai' }, // reads OPENAI_API_KEY from env
        tts: { provider: 'openai', voice: 'alloy' },
      }),
    ],
  })
  .build()
```

### Environment variables

| Variable         | Required                               | Default for                                           |
| ---------------- | -------------------------------------- | ----------------------------------------------------- |
| `OPENAI_API_KEY` | yes (default STT + TTS provider)       | `stt.provider: "openai"` AND `tts.provider: "openai"` |
| `GROQ_API_KEY`   | only if you set `stt.provider: "groq"` | Groq Whisper (no TTS — fall back to OpenAI)           |

You can override the env var name with `stt.envVar` / `tts.envVar`, or pass `stt.apiKey` / `tts.apiKey` explicitly in code.

### Endpoints

| Method | Path (default)   | Body                                     | Response                                |
| ------ | ---------------- | ---------------------------------------- | --------------------------------------- |
| POST   | `/api/voice/stt` | `multipart/form-data` with field `audio` | `{ transcript, language?, durationMs }` |
| POST   | `/api/voice/tts` | `application/json` `{ text, voice? }`    | `audio/mpeg` stream                     |

Both paths are configurable via `stt.endpoint` / `tts.endpoint`. They must start with `/`.

## Browser usage

<!-- doc-example: needs="@theokit/ui" -->

```tsx
// React 18/19 client component
'use client'
import { useState } from 'react'

import { VoiceRecorderBar } from '@theokit/plugin-voice/ui'
import { ChatComposer } from '@theokit/ui'

export function ChatPage() {
  const [value, setValue] = useState('')
  return (
    <ChatComposer
      value={value}
      onValueChange={setValue}
      leadingActions={<VoiceRecorderBar onTranscript={(t) => setValue((v) => v + ' ' + t)} />}
    />
  )
}
```

> **Browser requirements (EC-15):** `MediaRecorder` + `navigator.mediaDevices.getUserMedia` only work in **secure contexts** (HTTPS or `localhost`). The recorder will throw `VoicePermissionDeniedError` on plain `http://` even after user grants permission — wrap your dev server with `mkcert` or run on `localhost`.

## Server-side functions

When you need the transcript or the audio as a value (a chat gateway, a background job) rather than an HTTP `Response`, call `transcribe` and `synthesize`. They apply the same size limits (25 MB audio, 4096 characters), timeout (30 s default) and abort handling as the handlers, and throw typed errors instead of returning a status: `VoiceInputError` (`code`: `INVALID_AUDIO`, `INVALID_BODY`, `INPUT_TOO_LONG`, `INVALID_VOICE`, `INVALID_SPEED`) and `VoiceProviderError` (`code`: `UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK`, `UPSTREAM_ERROR`, `UPSTREAM_PARSE`, `UPSTREAM_EMPTY`, plus `status`).

<!-- doc-example: partial -->

```ts
import { transcribe } from '@theokit/plugin-voice'

const text = await transcribe(
  { data: oggBytes, mediaType: 'audio/ogg' },
  {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o-mini-transcribe',
    endpoint: '/api/voice/stt',
  },
  { language: 'en', timeoutMs: 20_000 },
)
```

<!-- doc-example: partial -->

```ts
import { synthesize, VoiceInputError } from '@theokit/plugin-voice'

try {
  const { data, mediaType } = await synthesize(
    'Your report is ready.',
    {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'tts-1',
      voice: 'alloy',
      endpoint: '/api/voice/tts',
    },
    { format: 'opus' }, // mediaType: 'audio/ogg'
  )
  await sendVoiceNote(data, mediaType)
} catch (e) {
  if (e instanceof VoiceInputError) console.error(e.code)
  else throw e
}
```

## Error hierarchy

All errors extend a base `VoicePluginError`. Catch the base class for generic handling, or the specific subclass for targeted UX:

<!-- doc-example: partial -->

```ts
import {
  VoicePluginError,
  VoicePermissionDeniedError,
  VoiceNoDeviceError,
  VoicePluginConfigError,
  VoiceProviderError,
  VoiceInputError,
} from '@theokit/plugin-voice'

try {
  await recorder.start()
} catch (e) {
  if (e instanceof VoicePermissionDeniedError) showAuthAlert()
  else if (e instanceof VoiceNoDeviceError) showNoDeviceAlert()
  else throw e
}
```

| Class                        | When                           | Where it fires                           |
| ---------------------------- | ------------------------------ | ---------------------------------------- |
| `VoicePermissionDeniedError` | User denied mic                | Browser, `recorder.start()`              |
| `VoiceNoDeviceError`         | No mic device present          | Browser, `recorder.start()`              |
| `VoicePluginConfigError`     | Missing API key                | Server, `voicePlugin(opts)` construction |
| `VoiceInputError`            | Invalid audio/text/voice/speed | Server, `transcribe()` / `synthesize()`  |
| `VoiceProviderError`         | STT/TTS provider call failed   | Server, endpoints and server functions   |

## License

MIT — see [LICENSE](./LICENSE).

## Wake word (on-device)

`startWakeWordListener` listens to the microphone and starts a recording when an enrolled word is
heard. Matching runs in the page (MFCC + dynamic time warping), so no audio is sent to a provider
until you stop the recording and post it to `/api/voice/stt`. It is speaker-dependent: enroll the
word with 3 or more utterances first.

```ts
import { enrollWakeWord, startWakeWordListener, type AudioClip } from '@theokit/plugin-voice'

// 3 or more recorded utterances of the word: { samples: Float32Array, sampleRate }
const clips: AudioClip[] = []
const profile = enrollWakeWord('theo', clips)
await startWakeWordListener({
  profile,
  onWake: () => console.log('wake'),
  onRecording: async (recorder) => {
    /* later: const blob = await recorder.stop() and POST it to /api/voice/stt */
  },
})
```

The profile is plain JSON; persist it and reuse it. Requires a secure context.
