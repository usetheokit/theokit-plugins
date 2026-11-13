/**
 * `transcribe()` — speech-to-text as a plain function returning the transcript string.
 *
 * Holds the provider logic (limits, timeout, abort, error mapping) that `handleSttRequest` wraps.
 * Failures throw `VoiceInputError` (bad input) or `VoiceProviderError` (upstream failure).
 */

import { VoiceInputError, VoiceProviderError } from '../errors.js'
import type { VoiceConfig } from '../options.js'

/** Hard upper bound — Whisper REST refuses anything larger. */
export const MAX_BODY_BYTES = 25 * 1024 * 1024

/** Default upstream timeout (ADR D8). */
export const DEFAULT_TIMEOUT_MS = 30_000

const PROVIDER_URL: Record<VoiceConfig['stt']['provider'], string> = {
  openai: 'https://api.openai.com/v1/audio/transcriptions',
  groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
}

/** The fetch seam; `globalThis.fetch` is assignable to it. */
export type FetchImpl = (url: string | URL, init: RequestInit) => Promise<Response>

export interface TranscribeAudio {
  readonly data: Uint8Array | ArrayBuffer | Blob
  /** e.g. `'audio/ogg'` */
  readonly mediaType: string
  readonly filename?: string
}

export interface TranscribeOptions {
  readonly language?: string
  readonly prompt?: string
  /** Upstream timeout in ms. Default 30_000. */
  readonly timeoutMs?: number
  /** Caller abort signal; aborts the in-flight upstream request. */
  readonly signal?: AbortSignal
  readonly fetchImpl?: FetchImpl
}

/** Transcript plus what the handler needs to report. */
export interface TranscribeDetail {
  text: string
  language?: string
}

const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/webm': 'webm',
}

/** Transcribe audio through the configured provider and resolve with the transcript text. */
export async function transcribe(
  audio: TranscribeAudio,
  config: VoiceConfig['stt'],
  opts: TranscribeOptions = {},
): Promise<string> {
  return (await transcribeDetailed(audio, config, opts)).text
}

/** Same as {@link transcribe} but also returns the language the provider reported. */
export async function transcribeDetailed(
  audio: TranscribeAudio,
  config: VoiceConfig['stt'],
  opts: TranscribeOptions = {},
): Promise<TranscribeDetail> {
  const blob = toAudioBlob(audio)
  const base = audio.mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
  const filename =
    audio.filename !== undefined && audio.filename.length > 0
      ? audio.filename
      : `audio.${EXTENSIONS[base] ?? 'webm'}`

  const form = new FormData()
  form.append('file', blob, filename)
  form.append('model', config.model)
  form.append('response_format', 'json')
  if (opts.language !== undefined && opts.language.length > 0)
    form.append('language', opts.language)
  if (opts.prompt !== undefined && opts.prompt.length > 0) form.append('prompt', opts.prompt)

  const upstream = await callProvider(
    opts.fetchImpl ?? globalThis.fetch,
    PROVIDER_URL[config.provider],
    { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: form },
    { provider: config.provider, label: 'Whisper', ...opts },
  )

  let parsed: { text?: string; language?: string }
  try {
    parsed = (await upstream.json()) as { text?: string; language?: string }
  } catch (err) {
    throw new VoiceProviderError(
      config.provider,
      upstream.status,
      `Upstream ${config.provider} returned invalid JSON: ${err instanceof Error ? err.message : 'unknown'}`,
      { cause: err, code: 'UPSTREAM_PARSE' },
    )
  }
  const detail: TranscribeDetail = { text: parsed.text ?? '' }
  if (parsed.language !== undefined) detail.language = parsed.language
  return detail
}

/** Validate size and normalise to a Blob. */
function toAudioBlob(audio: TranscribeAudio): Blob {
  const data = audio?.data
  if (data === undefined || data === null) {
    throw new VoiceInputError('INVALID_AUDIO', 'Missing audio input.')
  }
  const size = data instanceof Blob ? data.size : data.byteLength
  if (size === 0) throw new VoiceInputError('INVALID_AUDIO', 'Audio payload is empty.')
  if (size > MAX_BODY_BYTES) {
    throw new VoiceInputError(
      'INVALID_AUDIO',
      `Audio payload (${size} bytes) exceeds the ${Math.floor(MAX_BODY_BYTES / 1024 / 1024)} MB Whisper limit. Chunk the recording client-side.`,
    )
  }
  if (data instanceof Blob) return data
  // Copy into a fresh ArrayBuffer-backed Uint8Array: Blob parts reject `Uint8Array<ArrayBufferLike>`.
  const ab = new ArrayBuffer(size)
  new Uint8Array(ab).set(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
  return new Blob([ab], { type: audio.mediaType })
}

/** True when an error is an abort/timeout (vs a genuine network failure). */
function isAbortLike(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

/**
 * POST to the provider with the timeout and caller signal applied. The call is raced against the
 * signal so a `fetchImpl` that ignores it still times out. Returns a 2xx response, or throws
 * `VoiceProviderError` (`UPSTREAM_TIMEOUT` / `UPSTREAM_NETWORK` / `UPSTREAM_ERROR`).
 */
export async function callProvider(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit,
  ctx: {
    provider: string
    label: string
    timeoutMs?: number | undefined
    signal?: AbortSignal | undefined
  },
): Promise<Response> {
  const signal = composeSignal(ctx)
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
      )
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  aborted.catch(() => undefined)
  let upstream: Response
  try {
    upstream = await Promise.race([fetchImpl(url, { ...init, signal }), aborted])
  } catch (err) {
    throw mapFetchError(err, signal, ctx)
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
  if (!upstream.ok) {
    const bodyText = await upstream.text().catch(() => '')
    throw new VoiceProviderError(
      ctx.provider,
      upstream.status,
      `Upstream ${ctx.provider} returned an error (status ${upstream.status}).`,
      { code: 'UPSTREAM_ERROR', upstreamBody: truncate(bodyText, 500) },
    )
  }
  return upstream
}

/** Compose the per-request timeout with the caller's abort signal. */
export function composeSignal(opts: {
  timeoutMs?: number | undefined
  signal?: AbortSignal | undefined
}): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return opts.signal !== undefined ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
}

/** Map a fetch (or body-read) rejection to a typed provider error. */
export function mapFetchError(
  err: unknown,
  signal: AbortSignal,
  ctx: { provider: string; label: string },
): VoiceProviderError {
  if (signal.aborted || isAbortLike(err)) {
    return new VoiceProviderError(
      ctx.provider,
      0,
      `Upstream ${ctx.provider} ${ctx.label} did not respond within the timeout.`,
      { cause: err, code: 'UPSTREAM_TIMEOUT' },
    )
  }
  return new VoiceProviderError(
    ctx.provider,
    0,
    `Network failure calling ${ctx.provider} ${ctx.label}: ${err instanceof Error ? err.message : 'unknown'}`,
    { cause: err, code: 'UPSTREAM_NETWORK' },
  )
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}
