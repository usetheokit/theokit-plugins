/**
 * Server-side STT handler for @theokit/plugin-voice.
 *
 * Accepts an already-parsed `SttInput` (audio blob/buffer + optional
 * language/prompt) and returns a `Response`. The caller is responsible
 * for getting the audio out of the inbound request — theokit's
 * `defineRoute` already parses multipart bodies, so the shim in
 * `server/routes/voice/stt.ts` is a 12-line adapter.
 *
 * Why we don't reconstruct a Web Standards `Request` from theokit's
 * `IncomingMessage` argument: theokit's `parseRequestBody` drains the
 * inbound stream BEFORE the handler runs, and wrapping the drained
 * stream via `Readable.toWeb()` puts undici's body tracker in a state
 * that later disturbs the returned `Response` (observed empirically in
 * the dogfood smoke spec — 500 "Response body object should not be
 * disturbed or locked"). Accepting a pre-parsed shape is both simpler
 * and uncoupled from any specific runtime.
 *
 * Hard constraints documented up-front:
 *   - Whisper REST has a hard 25 MB per-file limit (OpenAI docs).
 *     Enforced by `MAX_BODY_BYTES` so a pathological caller cannot
 *     exhaust the server's memory before this check.
 *
 * Provider abstraction (D11):
 *   - OpenAI Whisper REST: POST https://api.openai.com/v1/audio/transcriptions
 *   - Groq Whisper REST:  POST https://api.groq.com/openai/v1/audio/transcriptions
 *
 * Observability:
 *   - Every successful Response carries `X-Voice-Provider` and
 *     `X-Voice-Model` headers.
 *   - `durationMs` is the upstream provider's processing time.
 */

import type { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { VoiceProviderError } from '../errors.js'
import type { VoiceConfig } from '../options.js'

/** Hard upper bound — Whisper REST refuses anything larger. */
const MAX_BODY_BYTES = 25 * 1024 * 1024

const PROVIDER_URL: Record<VoiceConfig['stt']['provider'], string> = {
  openai: 'https://api.openai.com/v1/audio/transcriptions',
  groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
}

export type SttAudio =
  | Blob
  | { buffer: Buffer | Uint8Array | ArrayBuffer; mimeType?: string; filename?: string }

export interface SttInput {
  audio: SttAudio
  language?: string
  prompt?: string
}

export interface SttHandlerOptions {
  /**
   * Injected fetch seam. The handler always calls it with a concrete URL and an
   * explicit init, so the parameter type is the narrow subset it uses (DIP seam
   * that keeps test mocks simple). `globalThis.fetch` is assignable to it.
   */
  fetchImpl?: (url: string | URL, init: RequestInit) => Promise<Response>
  /**
   * Upstream request timeout in ms (#211). Defaults to 30s. After this elapses
   * the upstream fetch is aborted and the handler returns 504 `UPSTREAM_TIMEOUT`.
   */
  timeoutMs?: number
  /**
   * Client request AbortSignal (#211). When the caller aborts, the in-flight
   * upstream fetch is aborted too (no pending request is left dangling).
   */
  signal?: AbortSignal
}

/** Default upstream timeout (#211, ADR D8). */
const DEFAULT_TIMEOUT_MS = 30_000

/** True when an error is an abort/timeout (vs a genuine network failure). */
function isAbortLike(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

export interface SttResponseBody {
  transcript: string
  language?: string
  durationMs: number
}

export async function handleSttRequest(
  input: SttInput,
  config: VoiceConfig['stt'],
  opts: SttHandlerOptions = {},
): Promise<Response> {
  // #182/#188: behavior-preserving extraction into named helpers to keep this
  // orchestrator's cyclomatic complexity low. Each helper owns one concern.
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch

  const audioBlob = await validateSttAudio(input.audio)
  if (audioBlob instanceof Response) return audioBlob

  const filename = pickFilename(input.audio) ?? 'audio.webm'
  const upstreamForm = buildSttForm(audioBlob, filename, config.model, input)

  const startedAt = Date.now()
  let upstream: Response
  try {
    upstream = await fetchImpl(PROVIDER_URL[config.provider], {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: upstreamForm,
      signal: composeUpstreamSignal(opts),
    })
  } catch (err) {
    return mapSttFetchError(err, config.provider)
  }
  const durationMs = Date.now() - startedAt

  if (!upstream.ok) return rejectSttUpstream(upstream, config.provider)

  const parsed = await parseSttJson(upstream, config.provider)
  if (parsed instanceof Response) return parsed

  const body: SttResponseBody = { transcript: parsed.text ?? '', durationMs }
  if (parsed.language !== undefined) body.language = parsed.language

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Voice-Provider': config.provider,
      'X-Voice-Model': config.model,
    },
  })
}

/** Validate + normalize the audio to a Blob, or return a 400 Response (#182). */
async function validateSttAudio(audio: SttAudio): Promise<Blob | Response> {
  const audioBlob = await toBlob(audio)
  if (audioBlob === null) return jsonError(400, 'INVALID_AUDIO', 'Missing audio input.')
  if (audioBlob.size === 0) return jsonError(400, 'INVALID_AUDIO', 'Audio payload is empty.')
  if (audioBlob.size > MAX_BODY_BYTES) {
    return jsonError(
      400,
      'INVALID_AUDIO',
      `Audio payload (${audioBlob.size} bytes) exceeds the ${Math.floor(MAX_BODY_BYTES / 1024 / 1024)} MB Whisper limit. Chunk the recording client-side.`,
    )
  }
  return audioBlob
}

/** Assemble the Whisper multipart form. */
function buildSttForm(audioBlob: Blob, filename: string, model: string, input: SttInput): FormData {
  const form = new FormData()
  form.append('file', audioBlob, filename)
  form.append('model', model)
  form.append('response_format', 'json')
  if (input.language !== undefined && input.language.length > 0) form.append('language', input.language)
  if (input.prompt !== undefined && input.prompt.length > 0) form.append('prompt', input.prompt)
  return form
}

/** #211: compose the per-request timeout with the caller's abort signal. */
function composeUpstreamSignal(opts: { timeoutMs?: number; signal?: AbortSignal }): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return opts.signal !== undefined ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
}

/** #211: map an upstream fetch rejection to 504 (abort/timeout) or 502 (network). */
function mapSttFetchError(err: unknown, provider: VoiceConfig['stt']['provider']): Response {
  if (isAbortLike(err)) {
    return jsonError(
      504,
      'UPSTREAM_TIMEOUT',
      `Upstream ${provider} Whisper did not respond within the timeout.`,
    )
  }
  const wrapped = new VoiceProviderError(
    provider,
    0,
    `Network failure calling ${provider} Whisper: ${err instanceof Error ? err.message : 'unknown'}`,
    { cause: err },
  )
  return jsonError(502, 'UPSTREAM_NETWORK', wrapped.message)
}

/** #214: log the raw upstream body server-side; return a generic client error. */
async function rejectSttUpstream(
  upstream: Response,
  provider: VoiceConfig['stt']['provider'],
): Promise<Response> {
  const bodyText = await upstream.text().catch(() => '')
  const correlationId = randomUUID()
  console.error(
    `[voice:stt] upstream ${provider} returned ${upstream.status} [ref ${correlationId}]: ${truncate(bodyText, 500)}`,
  )
  return jsonError(
    upstream.status >= 500 ? 502 : upstream.status,
    'UPSTREAM_ERROR',
    `Upstream ${provider} returned an error (status ${upstream.status}). Reference: ${correlationId}`,
  )
}

/** Parse the Whisper JSON body, or return a 502 Response on malformed JSON. */
async function parseSttJson(
  upstream: Response,
  provider: VoiceConfig['stt']['provider'],
): Promise<{ text?: string; language?: string } | Response> {
  try {
    return (await upstream.json()) as { text?: string; language?: string }
  } catch (err) {
    return jsonError(
      502,
      'UPSTREAM_PARSE',
      `Upstream ${provider} returned invalid JSON: ${err instanceof Error ? err.message : 'unknown'}`,
    )
  }
}

async function toBlob(audio: SttAudio): Promise<Blob | null> {
  if (audio === null || audio === undefined) return null
  if (audio instanceof Blob) return audio
  const obj = audio as { buffer: Buffer | Uint8Array | ArrayBuffer; mimeType?: string }
  if (obj.buffer === undefined || obj.buffer === null) return null
  // Copy into a fresh ArrayBuffer-backed Uint8Array. The TS lib for
  // Blob requires `BlobPart` (ArrayBuffer | TypedArray<ArrayBuffer>),
  // and `Uint8Array<ArrayBufferLike>` (Node Buffer subtype) does not
  // satisfy that constraint under TS 5.9. The slice() is cheap given
  // the 25 MB hard cap enforced upstream.
  const src: Uint8Array | ArrayBuffer = obj.buffer
  const ab = new ArrayBuffer(src.byteLength)
  new Uint8Array(ab).set(
    src instanceof ArrayBuffer ? new Uint8Array(src) : (src),
  )
  return new Blob([ab], { type: obj.mimeType ?? 'audio/webm' })
}

function pickFilename(audio: SttAudio): string | undefined {
  if (audio instanceof Blob) {
    const name = (audio as Blob & { name?: string }).name
    return typeof name === 'string' && name.length > 0 ? name : undefined
  }
  const obj = audio as { filename?: string }
  return typeof obj.filename === 'string' && obj.filename.length > 0 ? obj.filename : undefined
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
