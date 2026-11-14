/**
 * Server-side TTS handler for @theokit/plugin-voice.
 *
 * Accepts an already-parsed `TtsInput` (`{ text, voice? }`) and returns
 * a `Response` whose body streams `audio/mpeg` directly from OpenAI
 * tts-1. The caller is responsible for parsing the inbound JSON body —
 * theokit's `route()` builder already does that, so the shim is a 12-line
 * adapter.
 *
 * Hard constraints:
 *   - OpenAI tts-1 max input length is 4096 characters → 400 INPUT_TOO_LONG.
 *   - Allowed voices come from the OpenAI tts-1 closed enum → 400 INVALID_VOICE.
 */

import { VoiceProviderError } from '../errors.js'
import type { VoiceConfig } from '../options.js'

import { errorToResponse } from './error-response.js'
import { buildSpeechInit, TTS_PROVIDER_URL, validateSynthesisInput } from './synthesize.js'
import { callProvider } from './transcribe.js'

export interface TtsInput {
  text: string
  voice?: string
  /**
   * Playback speed multiplier forwarded to OpenAI tts-1. Valid range is
   * [0.25, 4.0]; out-of-range values are rejected with 400 INVALID_SPEED.
   * Omit to use the default (1.0).
   */
  speed?: number
}

/**
 * Per-request options for {@link handleTtsRequest}.
 *
 * Same contract as the speech-to-text side: a bounded upstream timeout that surfaces as 504, and a
 * caller abort signal that cancels the in-flight request rather than orphaning it.
 */
export interface TtsHandlerOptions {
  /**
   * Injected fetch seam. The handler always calls it with a concrete URL and an
   * explicit init, so the parameter type is the narrow subset it uses (DIP seam
   * that keeps test mocks simple). `globalThis.fetch` is assignable to it.
   */
  fetchImpl?: (url: string | URL, init: RequestInit) => Promise<Response>
  /**
   * Upstream request timeout in ms (#212). Defaults to 30s. After this elapses
   * the upstream fetch is aborted and the handler returns 504 `UPSTREAM_TIMEOUT`.
   */
  timeoutMs?: number
  /**
   * Client request AbortSignal (#212). When the caller aborts, the upstream
   * fetch is aborted too — for a real fetch this also cancels the streamed
   * `audio/mpeg` response body (undici ties the body stream to the signal).
   */
  signal?: AbortSignal
}

/**
 * Synthesise speech through the configured provider and answer with a web `Response`.
 *
 * The audio streams back rather than being buffered, so playback can start before synthesis
 * finishes. Like its counterpart it returns a response and mounts nothing.
 */
export async function handleTtsRequest(
  input: TtsInput,
  config: VoiceConfig['tts'],
  opts: TtsHandlerOptions = {},
): Promise<Response> {
  try {
    const voice = validateSynthesisInput(input?.text, config, input.voice, input.speed)
    const upstream = await callProvider(
      opts.fetchImpl ?? globalThis.fetch,
      TTS_PROVIDER_URL[config.provider],
      buildSpeechInit(input.text, config, voice, 'mp3', input.speed),
      { provider: config.provider, label: 'TTS', ...opts },
    )
    if (upstream.body === null) {
      throw new VoiceProviderError(
        config.provider,
        upstream.status,
        `${config.provider} returned an empty audio body.`,
        { code: 'UPSTREAM_EMPTY' },
      )
    }

    const responseHeaders: Record<string, string> = {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-Voice-Provider': config.provider,
      'X-Voice-Model': config.model,
      'X-Voice-Voice': voice,
    }
    if (input.speed !== undefined) responseHeaders['X-Voice-Speed'] = String(input.speed)

    return new Response(upstream.body, { status: 200, headers: responseHeaders })
  } catch (err) {
    return errorToResponse(err, config.provider, 'tts')
  }
}
