/**
 * Server-side TTS handler for @theokit/plugin-voice.
 *
 * Accepts an already-parsed `TtsInput` (`{ text, voice? }`) and returns
 * a `Response` whose body streams `audio/mpeg` directly from OpenAI
 * tts-1. The caller is responsible for parsing the inbound JSON body —
 * theokit's `defineRoute` already does that, so the shim is a 12-line
 * adapter.
 *
 * Hard constraints:
 *   - OpenAI tts-1 max input length is 4096 characters → 400 INPUT_TOO_LONG.
 *   - Allowed voices come from the OpenAI tts-1 closed enum → 400 INVALID_VOICE.
 */

import { randomUUID } from 'node:crypto'

import { VoicePluginError } from '../errors.js'
import { VALID_VOICES, type VoiceConfig } from '../options.js'

/** OpenAI tts-1 max input length per docs (2026-05). */
const MAX_TEXT_CHARS = 4096

/**
 * Per-request voice validation set, derived from the SINGLE source of truth in
 * `options.ts` (#215). The schema validates the configured default; this guards
 * a per-request `input.voice` override (which is an arbitrary client string).
 */
const VOICE_SET = new Set<string>(VALID_VOICES)

const PROVIDER_URL: Record<VoiceConfig['tts']['provider'], string> = {
  openai: 'https://api.openai.com/v1/audio/speech',
}

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

/** Default upstream timeout (#212, ADR D8). */
const DEFAULT_TIMEOUT_MS = 30_000

/** True when an error is an abort/timeout (vs a genuine network failure). */
function isAbortLike(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')
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
  // #182/#189: behavior-preserving extraction into named helpers to keep this
  // orchestrator's cyclomatic complexity low.
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch

  const validated = validateTtsInput(input, config)
  if (validated instanceof Response) return validated
  const { voice } = validated

  const upstreamPayload: Record<string, unknown> = {
    model: config.model,
    voice,
    input: input.text,
    response_format: 'mp3',
  }
  if (input.speed !== undefined && input.speed !== 1) {
    upstreamPayload.speed = input.speed
  }

  let upstream: Response
  try {
    upstream = await fetchImpl(PROVIDER_URL[config.provider], {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamPayload),
      signal: composeUpstreamSignal(opts),
    })
  } catch (err) {
    return mapTtsFetchError(err, config.provider)
  }

  if (!upstream.ok) return rejectTtsUpstream(upstream, config.provider)
  if (upstream.body === null) {
    return jsonError(502, 'UPSTREAM_EMPTY', `${config.provider} returned an empty audio body.`)
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
}

/** Validate text/voice/speed and resolve the voice, or return a 400 Response. */
function validateTtsInput(
  input: TtsInput,
  config: VoiceConfig['tts'],
): { voice: string } | Response {
  if (typeof input?.text !== 'string' || input.text.length === 0) {
    return jsonError(400, 'INVALID_BODY', '"text" is required and must be a non-empty string.')
  }
  if (input.text.length > MAX_TEXT_CHARS) {
    return jsonError(
      400,
      'INPUT_TOO_LONG',
      `"text" exceeds the ${MAX_TEXT_CHARS}-character limit imposed by OpenAI tts-1. Split the input client-side.`,
    )
  }
  const voice = input.voice ?? config.voice
  if (!VOICE_SET.has(voice)) {
    return jsonError(
      400,
      'INVALID_VOICE',
      `"${voice}" is not an OpenAI tts-1 voice. Allowed: ${[...VALID_VOICES].sort().join(', ')}.`,
    )
  }
  const speedError = validateTtsSpeed(input.speed)
  if (speedError !== undefined) return speedError
  return { voice }
}

/** Validate the optional playback speed; returns a 400 Response or undefined. */
function validateTtsSpeed(speed: number | undefined): Response | undefined {
  if (speed === undefined) return undefined
  if (typeof speed !== 'number' || !Number.isFinite(speed)) {
    return jsonError(400, 'INVALID_SPEED', '"speed" must be a finite number.')
  }
  if (speed < 0.25 || speed > 4.0) {
    return jsonError(
      400,
      'INVALID_SPEED',
      `"speed" ${speed} is outside the OpenAI tts-1 range [0.25, 4.0].`,
    )
  }
  return undefined
}

/** #212: compose the per-request timeout with the caller's abort signal. */
function composeUpstreamSignal(opts: { timeoutMs?: number; signal?: AbortSignal }): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return opts.signal !== undefined ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
}

/** #212: map an upstream fetch rejection to 504 (abort/timeout) or 502 (network). */
function mapTtsFetchError(err: unknown, provider: VoiceConfig['tts']['provider']): Response {
  if (isAbortLike(err)) {
    return jsonError(
      504,
      'UPSTREAM_TIMEOUT',
      `Upstream ${provider} TTS did not respond within the timeout.`,
    )
  }
  const wrapped = new VoicePluginError(
    `Network failure calling ${provider} TTS: ${err instanceof Error ? err.message : 'unknown'}`,
    { cause: err },
  )
  return jsonError(502, 'UPSTREAM_NETWORK', wrapped.message)
}

/** #214: log the raw upstream body server-side; return a generic client error. */
async function rejectTtsUpstream(
  upstream: Response,
  provider: VoiceConfig['tts']['provider'],
): Promise<Response> {
  const text = await upstream.text().catch(() => '')
  const correlationId = randomUUID()
  console.error(
    `[voice:tts] upstream ${provider} returned ${upstream.status} [ref ${correlationId}]: ${truncate(text, 500)}`,
  )
  return jsonError(
    upstream.status >= 500 ? 502 : upstream.status,
    'UPSTREAM_ERROR',
    `Upstream ${provider} returned an error (status ${upstream.status}). Reference: ${correlationId}`,
  )
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}
