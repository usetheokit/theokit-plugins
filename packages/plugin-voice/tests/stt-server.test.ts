/**
 * Server-side STT handler unit tests.
 *
 * The handler accepts a pre-parsed `SttInput` (audio blob/buffer +
 * optional language/prompt). Each test builds the input directly and
 * inspects the returned `Response`.
 */
import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { handleSttRequest, type SttInput } from '../src/server/stt-server.js'
import type { VoiceConfig } from '../src/options.js'

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

const sttConfig: VoiceConfig['stt'] = {
  provider: 'openai',
  apiKey: 'sk-test-key',
  model: 'whisper-1',
  endpoint: '/api/voice/stt',
}

function makeBlobInput(bytes: number[] = [1, 2, 3, 4, 5]): SttInput {
  return {
    audio: { buffer: Buffer.from(bytes), mimeType: 'audio/webm', filename: 'speech.webm' },
  }
}

describe('handleSttRequest', () => {
  describe('happy path', () => {
    it('forwards audio buffer to upstream and returns transcript JSON', async () => {
      const fetchImpl = vi.fn((url: string | URL, init: RequestInit) => {
        expect(String(url)).toBe('https://api.openai.com/v1/audio/transcriptions')
        expect(init.method).toBe('POST')
        const auth = (init.headers as Record<string, string>).Authorization
        expect(auth).toBe('Bearer sk-test-key')
        return Promise.resolve(jsonResponse({ text: 'hello world', language: 'en' }))
      })

      const res = await handleSttRequest(makeBlobInput(), sttConfig, { fetchImpl })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
      expect(res.headers.get('X-Voice-Provider')).toBe('openai')
      expect(res.headers.get('X-Voice-Model')).toBe('whisper-1')
      const data = (await res.json()) as { transcript: string; language?: string }
      expect(data.transcript).toBe('hello world')
      expect(data.language).toBe('en')
    })

    it('forwards optional language and prompt fields upstream', async () => {
      let capturedForm: FormData | null = null
      const fetchImpl = vi.fn((_url: string | URL, init: RequestInit) => {
        capturedForm = init.body as FormData
        return Promise.resolve(jsonResponse({ text: 'olá', language: 'pt' }))
      })
      const input: SttInput = {
        ...makeBlobInput(),
        language: 'pt',
        prompt: 'Theokit, dogfood',
      }
      await handleSttRequest(input, sttConfig, { fetchImpl })
      expect(capturedForm).not.toBeNull()
      const form = capturedForm!
      expect(form.get('language')).toBe('pt')
      expect(form.get('prompt')).toBe('Theokit, dogfood')
      expect(form.get('model')).toBe('whisper-1')
      expect(form.get('response_format')).toBe('json')
    })

    it('routes to Groq URL when provider is "groq"', async () => {
      let calledUrl = ''
      const fetchImpl = vi.fn((url: string | URL) => {
        calledUrl = String(url)
        return Promise.resolve(jsonResponse({ text: 'hi' }))
      })
      await handleSttRequest(
        makeBlobInput(),
        { ...sttConfig, provider: 'groq', model: 'whisper-large-v3' },
        { fetchImpl },
      )
      expect(calledUrl).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    })

    it('accepts a Blob directly as audio', async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })
      const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ text: 'ok' })))
      const res = await handleSttRequest({ audio: blob }, sttConfig, { fetchImpl })
      expect(res.status).toBe(200)
    })
  })

  describe('input validation', () => {
    it('rejects empty audio with 400 INVALID_AUDIO', async () => {
      const res = await handleSttRequest(
        { audio: { buffer: Buffer.alloc(0), mimeType: 'audio/webm' } },
        sttConfig,
        { fetchImpl: vi.fn() },
      )
      expect(res.status).toBe(400)
      expect(await res.text()).toMatch(/INVALID_AUDIO/)
    })
  })

  describe('upstream failures', () => {
    it('upstream 401 maps to 401 with UPSTREAM_ERROR', async () => {
      const fetchImpl = vi.fn(() => Promise.resolve(new Response('Unauthorized', { status: 401 })))
      const res = await handleSttRequest(makeBlobInput(), sttConfig, { fetchImpl })
      expect(res.status).toBe(401)
      expect(await res.text()).toMatch(/UPSTREAM_ERROR/)
    })

    it('upstream 500 maps to 502 (treat as bad gateway)', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(new Response('Internal Error', { status: 500 })),
      )
      const res = await handleSttRequest(makeBlobInput(), sttConfig, { fetchImpl })
      expect(res.status).toBe(502)
      expect(await res.text()).toMatch(/UPSTREAM_ERROR/)
    })

    it('network failure maps to 502 UPSTREAM_NETWORK', async () => {
      const fetchImpl = vi.fn(() => Promise.reject(new Error('ECONNRESET')))
      const res = await handleSttRequest(makeBlobInput(), sttConfig, { fetchImpl })
      expect(res.status).toBe(502)
      expect(await res.text()).toMatch(/UPSTREAM_NETWORK/)
    })

    it('upstream non-JSON body maps to 502 UPSTREAM_PARSE', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          new Response('<html>oops</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
      )
      const res = await handleSttRequest(makeBlobInput(), sttConfig, { fetchImpl })
      expect(res.status).toBe(502)
      expect(await res.text()).toMatch(/UPSTREAM_PARSE/)
    })
  })

  describe('upstream error body not reflected (#214)', () => {
    it('test_upstream_error_body_not_reflected', async () => {
      const secret = 'SENSITIVE-PROVIDER-INTERNALS-key-leak-xyz'
      const fetchImpl = vi.fn(() =>
        Promise.resolve(new Response(secret, { status: 500, statusText: 'Internal Server Error' })),
      )
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const res = await handleSttRequest(makeBlobInput(), sttConfig, { fetchImpl })
        expect(res.status).toBe(502) // 5xx → 502
        const text = await res.text()
        // Raw upstream body must NOT be reflected to the client.
        expect(text).not.toContain(secret)
        // A correlation id is returned to the client for support...
        expect(text).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
        // ...and the raw body is logged server-side (with the same id).
        const logged = errSpy.mock.calls.flat().join(' ')
        expect(logged).toContain(secret)
      } finally {
        errSpy.mockRestore()
      }
    })
  })

  describe('timeout / abort (#211)', () => {
    it('test_stt_times_out_with_504_and_signal', async () => {
      // Deterministic: a pre-aborted client signal must surface as 504
      // UPSTREAM_TIMEOUT, and the handler MUST pass an AbortSignal to fetch.
      const fetchImpl = vi.fn((_url: string | URL, init: RequestInit) => {
        if (init.signal?.aborted) {
          const reason: unknown = init.signal.reason
          return Promise.reject(
            reason instanceof Error ? reason : new DOMException('aborted', 'AbortError'),
          )
        }
        // Pre-fix code passes no signal → reaches here → 200 → test fails fast.
        return Promise.resolve(
          new Response(JSON.stringify({ text: 'unused' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      })
      const controller = new AbortController()
      controller.abort()
      const res = await handleSttRequest(makeBlobInput(), sttConfig, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: controller.signal,
      })
      expect(res.status).toBe(504)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('UPSTREAM_TIMEOUT')
      expect(fetchImpl.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    })

    it('test_stt_client_signal_propagated_to_fetch', async () => {
      let captured: AbortSignal | undefined
      const fetchImpl = vi.fn((_url: string | URL, init: RequestInit) => {
        captured = init.signal ?? undefined
        return Promise.resolve(
          new Response(JSON.stringify({ text: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      })
      const controller = new AbortController()
      await handleSttRequest(makeBlobInput(), sttConfig, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: controller.signal,
      })
      controller.abort()
      // The composed signal handed to fetch reflects the client abort.
      expect(captured?.aborted).toBe(true)
    })
  })
})
