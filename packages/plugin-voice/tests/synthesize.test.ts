import { describe, expect, it, vi } from 'vitest'

import { VoiceProviderError, type VoiceInputError } from '../src/errors.js'
import type { VoiceConfig } from '../src/options.js'
import { synthesize } from '../src/server/synthesize.js'

const cfg: VoiceConfig['tts'] = {
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'tts-1',
  voice: 'alloy',
  endpoint: '/api/voice/tts',
}

describe('synthesize', () => {
  it('returns opus bytes with the ogg media type and sends response_format', async () => {
    const fetchImpl = vi.fn((_url: string | URL, _init: RequestInit) =>
      Promise.resolve(new Response(new Uint8Array([9, 8, 7]), { status: 200 })),
    )
    const out = await synthesize('hi', cfg, { format: 'opus', fetchImpl })
    expect(out.mediaType).toBe('audio/ogg')
    expect([...out.data]).toEqual([9, 8, 7])
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://api.openai.com/v1/audio/speech')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.response_format).toBe('opus')
    expect(body.input).toBe('hi')
  })

  it('defaults to mp3', async () => {
    const fetchImpl = vi.fn((_url: string | URL, _init: RequestInit) =>
      Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })),
    )
    const out = await synthesize('hi', cfg, { fetchImpl })
    expect(out.mediaType).toBe('audio/mpeg')
    const sent = JSON.parse(fetchImpl.mock.calls[0]![1].body as string) as {
      response_format: string
    }
    expect(sent.response_format).toBe('mp3')
  })

  it('rejects input errors with VoiceInputError codes', async () => {
    const code = async (text: string, o = {}) =>
      ((await synthesize(text, cfg, o).catch((e: unknown) => e)) as VoiceInputError).code
    expect(await code('x'.repeat(4097))).toBe('INPUT_TOO_LONG')
    expect(await code('')).toBe('INVALID_BODY')
    expect(await code('hi', { voice: 'nope' })).toBe('INVALID_VOICE')
    expect(await code('hi', { speed: 9 })).toBe('INVALID_SPEED')
  })

  it('rejects with UPSTREAM_TIMEOUT when fetch never resolves', async () => {
    const err = await synthesize('hi', cfg, {
      fetchImpl: () => new Promise(() => undefined),
      timeoutMs: 10,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VoiceProviderError)
    expect((err as VoiceProviderError).code).toBe('UPSTREAM_TIMEOUT')
  })

  it('rejects a 401 with UPSTREAM_ERROR and the status', async () => {
    const err = await synthesize('hi', cfg, {
      fetchImpl: () => Promise.resolve(new Response('no', { status: 401 })),
    }).catch((e: unknown) => e)
    expect((err as VoiceProviderError).code).toBe('UPSTREAM_ERROR')
    expect((err as VoiceProviderError).status).toBe(401)
  })

  it('rejects an empty body with UPSTREAM_EMPTY', async () => {
    const err = await synthesize('hi', cfg, {
      fetchImpl: () => Promise.resolve(new Response(new Uint8Array(0), { status: 200 })),
    }).catch((e: unknown) => e)
    expect((err as VoiceProviderError).code).toBe('UPSTREAM_EMPTY')
  })
})
