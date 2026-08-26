import { CONTROLLER_PREFIX, getMeta, ROUTE_METHODS, USE_GUARDS } from '@theokit/http'
import type { RouteMethodEntry } from '@theokit/http'
import { describe, expect, it } from 'vitest'

import { VoiceControllerBase } from '../src/server/voice-controller.js'
import type { VoiceConfig } from '../src/options.js'

/**
 * The point of the base class is that an app can vary path, config and per-verb access WITHOUT
 * editing this package. Each test below is one of those variations actually exercised — not an
 * assertion that the decorators are present, which would pass on a class that routes nowhere.
 */

const config: VoiceConfig = {
  stt: { provider: 'openai', apiKey: 'k', model: 'whisper-1', endpoint: 'https://x/stt' },
  tts: { provider: 'openai', apiKey: 'k', model: 'tts-1', voice: 'alloy', endpoint: 'https://x/tts' },
} as VoiceConfig

class TestVoiceController extends VoiceControllerBase {
  protected readonly config = config
}

describe('VoiceControllerBase', () => {
  it('declares the two verbs so a subclass inherits routes it never wrote', () => {
    const routes = getMeta(ROUTE_METHODS, TestVoiceController) as
      | RouteMethodEntry[]
      | undefined

    expect(routes?.map((r) => `${r.verb} ${r.path}`).sort()).toEqual(['POST stt', 'POST tts'])
  })

  it('binds no prefix, so the app owns the URL', () => {
    expect(getMeta(CONTROLLER_PREFIX, VoiceControllerBase)).toBeUndefined()
    expect(getMeta(CONTROLLER_PREFIX, TestVoiceController)).toBeUndefined()
  })

  it('binds no guard, so the app owns the access decision per verb', () => {
    expect(getMeta(USE_GUARDS, TestVoiceController, 'stt')).toBeUndefined()
    expect(getMeta(USE_GUARDS, TestVoiceController, 'tts')).toBeUndefined()
  })

  it('parses a multipart body into the transcription call the plugin owns', async () => {
    const seen: { audioSize: number; language?: string }[] = []
    class Spy extends VoiceControllerBase {
      protected readonly config = config
      protected transcribe(input: { audio: Blob; language?: string }) {
        seen.push({ audioSize: (input.audio as Blob).size, language: input.language })
        return Promise.resolve(new Response('ok'))
      }
    }

    const form = new FormData()
    form.set('audio', new Blob(['0123456789'], { type: 'audio/webm' }), 'a.webm')
    form.set('language', 'pt')

    const response = await new Spy().stt(
      new Request('http://x/api/voice/stt', { method: 'POST', body: form }),
    )

    expect(response.status).toBe(200)
    expect(seen).toEqual([{ audioSize: 10, language: 'pt' }])
  })

  it('answers 400 with a typed code when the multipart body carries no audio', async () => {
    const form = new FormData()
    form.set('language', 'pt')

    const response = await new TestVoiceController().stt(
      new Request('http://x/api/voice/stt', { method: 'POST', body: form }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'MISSING_AUDIO' })
  })

  it('hands the validated JSON body to the synthesis call', async () => {
    const seen: unknown[] = []
    class Spy extends VoiceControllerBase {
      protected readonly config = config
      protected synthesise(input: unknown) {
        seen.push(input)
        return Promise.resolve(new Response('ok'))
      }
    }

    await new Spy().tts({ text: 'olá', voice: 'nova' })

    expect(seen).toEqual([{ text: 'olá', voice: 'nova' }])
  })
})
