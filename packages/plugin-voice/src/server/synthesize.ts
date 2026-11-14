/**
 * `synthesize()` — text-to-speech as a plain function returning the audio bytes.
 *
 * Buffers the provider's response. `handleTtsRequest` shares the validation and request building
 * here but streams the body instead.
 */

import { VoiceInputError, VoiceProviderError } from '../errors.js'
import { VALID_VOICES, type VoiceConfig } from '../options.js'

import { callProvider, mapFetchError, type FetchImpl } from './transcribe.js'

/** OpenAI tts-1 max input length per docs (2026-05). */
export const MAX_TEXT_CHARS = 4096

const VOICE_SET = new Set<string>(VALID_VOICES)

export const TTS_PROVIDER_URL: Record<VoiceConfig['tts']['provider'], string> = {
  openai: 'https://api.openai.com/v1/audio/speech',
}

export type SynthesizeFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav'

const MEDIA_TYPES: Record<SynthesizeFormat, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
}

/** Per-call options for `synthesize()`: voice, speed, output format, timeout, abort signal and fetch seam. */
export interface SynthesizeOptions {
  readonly voice?: string
  /** Playback speed multiplier, [0.25, 4.0]. */
  readonly speed?: number
  /** Default `'mp3'`. */
  readonly format?: SynthesizeFormat
  /** Upstream timeout in ms. Default 30_000. */
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly fetchImpl?: FetchImpl
}

/** Synthesise speech through the configured provider and resolve with the audio bytes. */
export async function synthesize(
  text: string,
  config: VoiceConfig['tts'],
  opts: SynthesizeOptions = {},
): Promise<{ data: Uint8Array; mediaType: string }> {
  const format = opts.format ?? 'mp3'
  if (!(format in MEDIA_TYPES)) {
    throw new VoiceInputError('INVALID_BODY', `"format" ${String(format)} is not supported.`)
  }
  const voice = validateSynthesisInput(text, config, opts.voice, opts.speed)
  const ctx = { provider: config.provider, label: 'TTS', ...opts }
  const upstream = await callProvider(
    opts.fetchImpl ?? globalThis.fetch,
    TTS_PROVIDER_URL[config.provider],
    buildSpeechInit(text, config, voice, format, opts.speed),
    ctx,
  )
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await upstream.arrayBuffer())
  } catch (err) {
    throw mapFetchError(err, new AbortController().signal, ctx)
  }
  if (bytes.byteLength === 0) {
    throw new VoiceProviderError(
      config.provider,
      upstream.status,
      `${config.provider} returned an empty audio body.`,
      { code: 'UPSTREAM_EMPTY' },
    )
  }
  return { data: bytes, mediaType: MEDIA_TYPES[format] }
}

/** Validate text/voice/speed and resolve the voice; throws `VoiceInputError`. */
export function validateSynthesisInput(
  text: unknown,
  config: VoiceConfig['tts'],
  voiceOverride: string | undefined,
  speed: number | undefined,
): string {
  if (typeof text !== 'string' || text.length === 0) {
    throw new VoiceInputError('INVALID_BODY', '"text" is required and must be a non-empty string.')
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new VoiceInputError(
      'INPUT_TOO_LONG',
      `"text" exceeds the ${MAX_TEXT_CHARS}-character limit imposed by OpenAI tts-1. Split the input client-side.`,
    )
  }
  const voice = voiceOverride ?? config.voice
  if (!VOICE_SET.has(voice)) {
    throw new VoiceInputError(
      'INVALID_VOICE',
      `"${voice}" is not an OpenAI tts-1 voice. Allowed: ${[...VALID_VOICES].sort((a, b) => a.localeCompare(b)).join(', ')}.`,
    )
  }
  if (speed !== undefined) {
    if (typeof speed !== 'number' || !Number.isFinite(speed)) {
      throw new VoiceInputError('INVALID_SPEED', '"speed" must be a finite number.')
    }
    if (speed < 0.25 || speed > 4.0) {
      throw new VoiceInputError(
        'INVALID_SPEED',
        `"speed" ${speed} is outside the OpenAI tts-1 range [0.25, 4.0].`,
      )
    }
  }
  return voice
}

/** Build the provider request init (JSON body, auth header). `speed` is sent only when not 1. */
export function buildSpeechInit(
  text: string,
  config: VoiceConfig['tts'],
  voice: string,
  format: SynthesizeFormat,
  speed: number | undefined,
): RequestInit {
  const payload: Record<string, unknown> = {
    model: config.model,
    voice,
    input: text,
    response_format: format,
  }
  if (speed !== undefined && speed !== 1) payload.speed = speed
  return {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}
