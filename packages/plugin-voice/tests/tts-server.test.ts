/**
 * Server-side TTS handler unit tests.
 *
 * Handler accepts a pre-parsed `TtsInput` (`{ text, voice? }`) and
 * returns a streaming `Response`.
 */
import { describe, expect, it, vi } from 'vitest'

import { handleTtsRequest } from '../src/server/tts-server.js'
import type { VoiceConfig } from '../src/options.js'

function makeAudioStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

const ttsConfig: VoiceConfig['tts'] = {
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'tts-1',
  voice: 'alloy',
  endpoint: '/api/voice/tts',
}

describe('handleTtsRequest', () => {
  describe('happy path', () => {
    it('JSON body in → audio/mpeg stream out with correct headers', async () => {
      const audioChunks = [
        new Uint8Array([0xff, 0xfb, 0x90, 0x00]),
        new Uint8Array([0x12, 0x34, 0x56]),
      ]
      const fetchImpl = vi.fn(async (url: string | URL, init: RequestInit) => {
        expect(String(url)).toBe('https://api.openai.com/v1/audio/speech')
        const body = JSON.parse(init.body as string) as {
          model: string
          voice: string
          input: string
          response_format: string
        }
        expect(body.model).toBe('tts-1')
        expect(body.voice).toBe('alloy')
        expect(body.input).toBe('Hello world')
        expect(body.response_format).toBe('mp3')
        return new Response(makeAudioStream(audioChunks), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      })

      const res = await handleTtsRequest({ text: 'Hello world' }, ttsConfig, { fetchImpl })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('audio/mpeg')
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('X-Voice-Provider')).toBe('openai')
      expect(res.headers.get('X-Voice-Model')).toBe('tts-1')
      expect(res.headers.get('X-Voice-Voice')).toBe('alloy')

      const ab = await res.arrayBuffer()
      const expected = Buffer.concat(audioChunks.map((c) => Buffer.from(c)))
      expect(Buffer.from(ab).equals(expected)).toBe(true)
    })

    it('forwards speed to upstream + emits X-Voice-Speed header', async () => {
      let capturedBody: { speed?: number } = {}
      const fetchImpl = vi.fn(async (_url: string | URL, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string) as { speed?: number }
        return new Response(makeAudioStream([new Uint8Array([1])]), { status: 200 })
      })
      const res = await handleTtsRequest({ text: 'hi', speed: 1.25 }, ttsConfig, { fetchImpl })
      expect(capturedBody.speed).toBe(1.25)
      expect(res.headers.get('X-Voice-Speed')).toBe('1.25')
    })

    it('omits speed from upstream payload when speed === 1', async () => {
      let capturedBody: Record<string, unknown> = {}
      const fetchImpl = vi.fn(async (_url: string | URL, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
        return new Response(makeAudioStream([new Uint8Array([1])]), { status: 200 })
      })
      await handleTtsRequest({ text: 'hi', speed: 1 }, ttsConfig, { fetchImpl })
      expect('speed' in capturedBody).toBe(false)
    })

    it('body voice override wins over config default', async () => {
      let capturedBody: { voice?: string } = {}
      const fetchImpl = vi.fn(async (_url: string | URL, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string) as { voice?: string }
        return new Response(makeAudioStream([new Uint8Array([1])]), { status: 200 })
      })
      const res = await handleTtsRequest({ text: 'hi', voice: 'nova' }, ttsConfig, { fetchImpl })
      expect(capturedBody.voice).toBe('nova')
      expect(res.headers.get('X-Voice-Voice')).toBe('nova')
    })
  })

  describe('input validation', () => {
    it('rejects empty text with 400 INVALID_BODY', async () => {
      const res = await handleTtsRequest({ text: '' }, ttsConfig, { fetchImpl: vi.fn() })
      expect(res.status).toBe(400)
      expect(await res.text()).toMatch(/INVALID_BODY/)
    })

    it('rejects missing text with 400 INVALID_BODY', async () => {
      const res = await handleTtsRequest({ text: undefined as unknown as string }, ttsConfig, {
        fetchImpl: vi.fn(),
      })
      expect(res.status).toBe(400)
    })

    it('rejects text > 4096 chars with 400 INPUT_TOO_LONG', async () => {
      const longText = 'x'.repeat(4097)
      const res = await handleTtsRequest({ text: longText }, ttsConfig, { fetchImpl: vi.fn() })
      expect(res.status).toBe(400)
      expect(await res.text()).toMatch(/INPUT_TOO_LONG/)
    })

    it('rejects speed < 0.25 with 400 INVALID_SPEED', async () => {
      const res = await handleTtsRequest({ text: 'hi', speed: 0.1 }, ttsConfig, {
        fetchImpl: vi.fn(),
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toMatch(/INVALID_SPEED/)
    })

    it('rejects speed > 4.0 with 400 INVALID_SPEED', async () => {
      const res = await handleTtsRequest({ text: 'hi', speed: 5 }, ttsConfig, {
        fetchImpl: vi.fn(),
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toMatch(/INVALID_SPEED/)
    })

    it('rejects non-finite speed (NaN/Infinity) with 400 INVALID_SPEED', async () => {
      const res = await handleTtsRequest({ text: 'hi', speed: Number.NaN }, ttsConfig, {
        fetchImpl: vi.fn(),
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toMatch(/INVALID_SPEED/)
    })

    it('rejects invalid voice with 400 INVALID_VOICE (closed enum, lists allowed)', async () => {
      const res = await handleTtsRequest({ text: 'hi', voice: 'alley' }, ttsConfig, {
        fetchImpl: vi.fn(),
      })
      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toMatch(/INVALID_VOICE/)
      expect(text).toMatch(/alloy/)
    })
  })

  describe('upstream failures', () => {
    it('upstream 401 maps to 401 UPSTREAM_ERROR', async () => {
      const fetchImpl = vi.fn(async () => new Response('Unauthorized', { status: 401 }))
      const res = await handleTtsRequest({ text: 'hi' }, ttsConfig, { fetchImpl })
      expect(res.status).toBe(401)
      expect(await res.text()).toMatch(/UPSTREAM_ERROR/)
    })

    it('upstream 5xx maps to 502 UPSTREAM_ERROR', async () => {
      const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }))
      const res = await handleTtsRequest({ text: 'hi' }, ttsConfig, { fetchImpl })
      expect(res.status).toBe(502)
    })

    it('network failure maps to 502 UPSTREAM_NETWORK', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('ECONNRESET')
      })
      const res = await handleTtsRequest({ text: 'hi' }, ttsConfig, { fetchImpl })
      expect(res.status).toBe(502)
      expect(await res.text()).toMatch(/UPSTREAM_NETWORK/)
    })

    it('upstream null body maps to 502 UPSTREAM_EMPTY', async () => {
      const fetchImpl = vi.fn(
        async () => new Response(null, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }),
      )
      const res = await handleTtsRequest({ text: 'hi' }, ttsConfig, { fetchImpl })
      expect(res.status).toBe(502)
      expect(await res.text()).toMatch(/UPSTREAM_EMPTY/)
    })
  })

  describe('upstream error body not reflected (#214)', () => {
    it('test_upstream_error_body_not_reflected', async () => {
      const secret = 'SENSITIVE-TTS-PROVIDER-INTERNALS-leak-xyz'
      const fetchImpl = vi.fn(() =>
        Promise.resolve(new Response(secret, { status: 500, statusText: 'Internal Server Error' })),
      )
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const res = await handleTtsRequest({ text: 'hi' }, ttsConfig, {
          fetchImpl: fetchImpl as unknown as typeof fetch,
        })
        expect(res.status).toBe(502)
        const text = await res.text()
        expect(text).not.toContain(secret)
        expect(text).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
        const logged = errSpy.mock.calls.flat().join(' ')
        expect(logged).toContain(secret)
      } finally {
        errSpy.mockRestore()
      }
    })
  })

  describe('timeout / abort (#212)', () => {
    it('test_tts_times_out_and_cancels_stream_on_abort', async () => {
      // Deterministic: a pre-aborted client signal → 504 UPSTREAM_TIMEOUT, and an
      // AbortSignal is handed to fetch. NOTE: the real upstream *body* cancellation
      // on a mid-stream client abort is undici behavior (signal propagated to the
      // real fetch) — exercised by integration, not provable by this mock; here we
      // verify only the contract the handler owns: signal propagation + 504.
      const fetchImpl = vi.fn((_url: string | URL, init: RequestInit) => {
        if (init.signal?.aborted) {
          return Promise.reject(init.signal.reason ?? new DOMException('aborted', 'AbortError'))
        }
        return Promise.resolve(new Response(makeAudioStream([new Uint8Array([1])]), { status: 200 }))
      })
      const controller = new AbortController()
      controller.abort()
      const res = await handleTtsRequest({ text: 'hi' }, ttsConfig, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: controller.signal,
      })
      expect(res.status).toBe(504)
      expect((await res.json()).error.code).toBe('UPSTREAM_TIMEOUT')
      expect(fetchImpl.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    })

    it('test_tts_client_signal_propagated_to_fetch', async () => {
      let captured: AbortSignal | undefined
      const fetchImpl = vi.fn((_url: string | URL, init: RequestInit) => {
        captured = init.signal ?? undefined
        return Promise.resolve(new Response(makeAudioStream([new Uint8Array([1])]), { status: 200 }))
      })
      const controller = new AbortController()
      await handleTtsRequest({ text: 'hi' }, ttsConfig, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: controller.signal,
      })
      controller.abort()
      expect(captured?.aborted).toBe(true)
    })
  })
})
