import { describe, expect, it, vi } from 'vitest'

import { VoiceInputError, VoiceProviderError } from '../src/errors.js'
import type { VoiceConfig } from '../src/options.js'
import { transcribe } from '../src/server/transcribe.js'

const cfg: VoiceConfig['stt'] = {
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini-transcribe',
  endpoint: '/api/voice/stt',
}
const data = new Uint8Array([1, 2, 3])

describe('transcribe', () => {
  it('posts multipart to the provider and resolves the text', async () => {
    const fetchImpl = vi.fn((_url: string | URL, _init: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ text: 'hello' }), { status: 200 })),
    )
    const text = await transcribe({ data, mediaType: 'audio/ogg' }, cfg, {
      fetchImpl,
      language: 'en',
    })
    expect(text).toBe('hello')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(form.get('language')).toBe('en')
    const file = form.get('file') as File
    expect(file.name).toBe('audio.ogg')
    expect(file.size).toBe(3)
  })

  it('rejects empty audio with INVALID_AUDIO', async () => {
    const err = await transcribe({ data: new Uint8Array(0), mediaType: 'audio/ogg' }, cfg).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(VoiceInputError)
    expect((err as VoiceInputError).code).toBe('INVALID_AUDIO')
  })

  it('rejects with UPSTREAM_TIMEOUT when fetch never resolves', async () => {
    const fetchImpl = (): Promise<Response> => new Promise(() => undefined)
    const err = await transcribe({ data, mediaType: 'audio/ogg' }, cfg, {
      fetchImpl,
      timeoutMs: 10,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VoiceProviderError)
    expect((err as VoiceProviderError).code).toBe('UPSTREAM_TIMEOUT')
  })

  it('rejects a 401 with UPSTREAM_ERROR and the status', async () => {
    const fetchImpl = () => Promise.resolve(new Response('nope', { status: 401 }))
    const err = await transcribe({ data, mediaType: 'audio/ogg' }, cfg, { fetchImpl }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(VoiceProviderError)
    expect((err as VoiceProviderError).code).toBe('UPSTREAM_ERROR')
    expect((err as VoiceProviderError).status).toBe(401)
    expect((err as VoiceProviderError).message).not.toContain('nope')
  })

  it('maps network failure and bad JSON', async () => {
    const net = await transcribe({ data, mediaType: 'audio/ogg' }, cfg, {
      fetchImpl: () => Promise.reject(new TypeError('boom')),
    }).catch((e: unknown) => e)
    expect((net as VoiceProviderError).code).toBe('UPSTREAM_NETWORK')
    const bad = await transcribe({ data, mediaType: 'audio/ogg' }, cfg, {
      fetchImpl: () => Promise.resolve(new Response('not json', { status: 200 })),
    }).catch((e: unknown) => e)
    expect((bad as VoiceProviderError).code).toBe('UPSTREAM_PARSE')
  })
})
