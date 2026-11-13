/**
 * Server-side STT handler for @theokit/plugin-voice.
 *
 * Accepts an already-parsed `SttInput` (audio blob/buffer + optional
 * language/prompt) and returns a `Response`. The caller is responsible
 * for getting the audio out of the inbound request — theokit's
 * `route()` builder already parses multipart bodies, so the shim in
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

import { VoiceInputError, VoiceProviderError } from '../errors.js'
import type { VoiceConfig } from '../options.js'

import { MAX_BODY_BYTES, transcribeDetailed, truncate, type TranscribeAudio } from './transcribe.js'

export { MAX_BODY_BYTES }

export type SttAudio =
  | Blob
  | { buffer: Buffer | Uint8Array | ArrayBuffer; mimeType?: string; filename?: string }

/**
 * One speech-to-text request: the audio, plus optional hints.
 *
 * `language` skips upstream detection when the caller already knows it, and `prompt` biases the
 * transcription toward expected vocabulary — names and jargon a general model would otherwise
 * mangle.
 */
export interface SttInput {
  audio: SttAudio
  language?: string
  prompt?: string
}

/**
 * Per-request options for {@link handleSttRequest}.
 *
 * `timeoutMs` bounds the upstream call and turns a hung provider into a 504 rather than a request
 * that never answers; `signal` propagates the client's own abort so a user who navigates away does
 * not leave an upstream fetch running.
 */
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

/** A successful transcription: the text, the language actually used, and the audio's duration. */
export interface SttResponseBody {
  transcript: string
  language?: string
  durationMs: number
}

/**
 * Transcribe audio through the configured provider and answer with a web `Response`.
 *
 * Upstream failures are mapped to status codes rather than thrown — a provider timeout becomes 504
 * `UPSTREAM_TIMEOUT`, an auth failure its own code — so the caller routes on a status instead of
 * matching error strings. It returns a response and registers no route: mounting stays the
 * application's job.
 */
export async function handleSttRequest(
  input: SttInput,
  config: VoiceConfig['stt'],
  opts: SttHandlerOptions = {},
): Promise<Response> {
  const audio = toTranscribeAudio(input.audio)
  const startedAt = Date.now()
  let detail
  try {
    detail = await transcribeDetailed(audio, config, {
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    })
  } catch (err) {
    return errorToResponse(err, config.provider)
  }
  const durationMs = Date.now() - startedAt

  const body: SttResponseBody = { transcript: detail.text, durationMs }
  if (detail.language !== undefined) body.language = detail.language

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Voice-Provider': config.provider,
      'X-Voice-Model': config.model,
    },
  })
}

/** Map a thrown voice error back to the status/body the handler has always answered with. */
function errorToResponse(err: unknown, provider: string): Response {
  if (err instanceof VoiceInputError) return jsonError(400, err.code, err.message)
  if (err instanceof VoiceProviderError) {
    switch (err.code) {
      case 'UPSTREAM_TIMEOUT':
        return jsonError(504, err.code, err.message)
      case 'UPSTREAM_ERROR': {
        // #214: log the raw upstream body server-side; return a generic client error.
        const correlationId = randomUUID()
        console.error(
          `[voice:stt] upstream ${provider} returned ${err.status} [ref ${correlationId}]: ${truncate(err.upstreamBody ?? '', 500)}`,
        )
        return jsonError(
          err.status >= 500 ? 502 : err.status,
          'UPSTREAM_ERROR',
          `Upstream ${provider} returned an error (status ${err.status}). Reference: ${correlationId}`,
        )
      }
      default:
        return jsonError(502, err.code ?? 'UPSTREAM_ERROR', err.message)
    }
  }
  throw err
}

/** Normalise the handler's audio shapes to {@link TranscribeAudio}. */
function toTranscribeAudio(audio: SttAudio): TranscribeAudio {
  const filename = pickFilename(audio) ?? 'audio.webm'
  if (audio === null || audio === undefined) {
    return { data: undefined as unknown as Blob, mediaType: 'audio/webm', filename }
  }
  if (audio instanceof Blob) return { data: audio, mediaType: audio.type, filename }
  const obj = audio as { buffer?: Buffer | Uint8Array | ArrayBuffer; mimeType?: string }
  return {
    data: (obj.buffer ?? undefined) as unknown as Uint8Array,
    mediaType: obj.mimeType ?? 'audio/webm',
    filename,
  }
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
