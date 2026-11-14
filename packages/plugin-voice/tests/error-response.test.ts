import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceInputError, VoiceProviderError } from '../src/errors.js'
import { errorToResponse } from '../src/server/error-response.js'

async function body(res: Response): Promise<{ error: { code: string; message: string } }> {
  return (await res.json()) as { error: { code: string; message: string } }
}

describe('errorToResponse', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps input errors to 400', async () => {
    const res = errorToResponse(new VoiceInputError('INVALID_BODY', 'bad'), 'openai', 'tts')
    expect(res.status).toBe(400)
    expect((await body(res)).error.code).toBe('INVALID_BODY')
  })

  it('maps a timeout to 504', () => {
    const err = new VoiceProviderError('openai', 0, 't', { code: 'UPSTREAM_TIMEOUT' })
    expect(errorToResponse(err, 'openai', 'stt').status).toBe(504)
  })

  it.each([
    [500, 502],
    [429, 429],
  ])('maps upstream %i to %i, logs with the label and hides the upstream body', async (up, out) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new VoiceProviderError('openai', up, 'x', {
      code: 'UPSTREAM_ERROR',
      upstreamBody: 'SECRET',
    })
    const res = errorToResponse(err, 'openai', 'stt')
    expect(res.status).toBe(out)
    expect(JSON.stringify(await body(res))).not.toContain('SECRET')
    expect(String(spy.mock.calls[0]?.[0])).toContain('[voice:stt] upstream openai')
  })

  it('maps other provider codes to 502', () => {
    const err = new VoiceProviderError('openai', 200, 'x', { code: 'UPSTREAM_EMPTY' })
    expect(errorToResponse(err, 'openai', 'tts').status).toBe(502)
  })

  it('rethrows unknown errors', () => {
    expect(() => errorToResponse(new Error('boom'), 'openai', 'tts')).toThrow('boom')
  })
})
