/** Shared mapping from a thrown voice error to the HTTP response the STT and TTS handlers answer with. */

import { randomUUID } from 'node:crypto'

import { VoiceInputError, VoiceProviderError } from '../errors.js'

import { truncate } from './transcribe.js'

/** A JSON `{ error: { code, message } }` response. */
export function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/**
 * Map a thrown voice error to the status/body the handlers have always answered with. `label`
 * (`'stt'` or `'tts'`) prefixes the server-side log line. Unknown errors are rethrown.
 */
export function errorToResponse(err: unknown, provider: string, label: 'stt' | 'tts'): Response {
  if (err instanceof VoiceInputError) return jsonError(400, err.code, err.message)
  if (err instanceof VoiceProviderError) {
    switch (err.code) {
      case 'UPSTREAM_TIMEOUT':
        return jsonError(504, err.code, err.message)
      case 'UPSTREAM_ERROR': {
        // #214: log the raw upstream body server-side; return a generic client error.
        const correlationId = randomUUID()
        console.error(
          `[voice:${label}] upstream ${provider} returned ${err.status} [ref ${correlationId}]: ${truncate(err.upstreamBody ?? '', 500)}`,
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
