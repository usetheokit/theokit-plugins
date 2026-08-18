/**
 * Voice — live tests against the real OpenAI speech APIs.
 *
 * The unit suites drive these handlers through an injected `fetchImpl`, so they
 * prove the request we BUILD is the request we intended. They cannot prove the
 * request is one OpenAI still accepts, and that is the whole gap: the handlers
 * post multipart form-data to `/v1/audio/transcriptions` and JSON to
 * `/v1/audio/speech`, and both shapes are the provider's to change.
 *
 * The valuable thing here is that the two halves can check each other. TTS
 * produces real audio; that audio is then fed to STT, and the transcript has to
 * contain the words we asked to be spoken. Neither half can fake that alone:
 * a broken TTS yields audio STT cannot read, and a broken STT fails on audio
 * that is provably good. One assertion covers the round trip that no fixture can
 * reproduce, because a canned wav file would only ever test STT.
 *
 * Cost is a fraction of a cent per run: one short sentence of tts-1 plus one
 * whisper transcription of the ~1s clip it produces.
 */

import { handleSttRequest, handleTtsRequest, resolveVoiceConfig } from '@theokit/plugin-voice'
import { expect, it } from 'vitest'

import { optional, required } from '../../src/credentials.js'
import { describeLive } from '../../src/harness.js'
import { serviceById } from '../../src/services.js'

const VOICE = serviceById('voice')

/**
 * The plugin types `voice` as a union of the six OpenAI voices, so an arbitrary
 * env string is not assignable. Validating here rather than casting means a typo
 * in VOICE_TEST_TTS_VOICE fails loudly instead of being smuggled past the type
 * system and rejected later by OpenAI.
 */
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const
type Voice = (typeof VOICES)[number]

function ttsVoice(): Voice {
  const raw = optional('VOICE_TEST_TTS_VOICE') ?? 'alloy'
  const hit = VOICES.find((v) => v === raw)
  if (hit === undefined) {
    throw new Error(`VOICE_TEST_TTS_VOICE="${raw}" is not one of ${VOICES.join(', ')}`)
  }
  return hit
}

/** A phrase chosen to transcribe unambiguously: common words, no proper nouns. */
const SPOKEN_PHRASE = 'the quick brown fox jumps over the lazy dog'

/**
 * Options are nested per capability (`{ stt, tts }`), and each half resolves its
 * own key — falling back to OPENAI_API_KEY / GROQ_API_KEY from the environment
 * when not passed. Passing explicitly keeps the suite independent of whatever
 * happens to be exported in the shell.
 */
function config(
  overrides: { sttKey?: string; ttsKey?: string; sttProvider?: 'openai' | 'groq' } = {},
) {
  return resolveVoiceConfig({
    stt: {
      provider: overrides.sttProvider ?? 'openai',
      apiKey: overrides.sttKey ?? required('OPENAI_API_KEY'),
    },
    tts: {
      provider: 'openai',
      apiKey: overrides.ttsKey ?? required('OPENAI_API_KEY'),
      voice: ttsVoice(),
    },
  })
}

describeLive(
  VOICE,
  'text to speech',
  () => {
    it('synthesizes audio OpenAI returns as playable bytes', async () => {
      const res = await handleTtsRequest({ text: SPOKEN_PHRASE }, config().tts)

      expect(res.status).toBe(200)
      // The contract is bytes, not JSON. A provider that started answering with a
      // job envelope instead of the audio would still be a 200.
      expect(res.headers.get('content-type') ?? '').toMatch(/^audio\//)
      const bytes = new Uint8Array(await res.arrayBuffer())
      expect(bytes.byteLength, 'empty audio body').toBeGreaterThan(1000)
    }, 60_000)

    it('surfaces a rejected key as an error response, not a thrown fetch', async () => {
      const res = await handleTtsRequest(
        { text: 'auth probe' },
        config({ ttsKey: 'sk-not-a-real-key-000000000000000000000000' }).tts,
      )

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(600)
    }, 60_000)
  },
  { requires: ['OPENAI_API_KEY'] },
)

describeLive(
  VOICE,
  'speech to text, on audio this suite just produced',
  () => {
    it('transcribes the phrase TTS spoke, closing the round trip', async () => {
      // The assertion no fixture can give you. A canned wav would only exercise
      // STT; generating the audio here means a break in EITHER half shows up.
      const spoken = await handleTtsRequest({ text: SPOKEN_PHRASE }, config().tts)
      expect(spoken.status, 'TTS failed, so STT cannot be judged').toBe(200)
      const audio = new Uint8Array(await spoken.arrayBuffer())

      const res = await handleSttRequest(
        { audio: { buffer: audio, mimeType: 'audio/mpeg', filename: 'probe.mp3' } },
        config().stt,
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { transcript?: string }
      const transcript = (body.transcript ?? '').toLowerCase()

      // Whisper punctuates and capitalizes freely, so assert on content words
      // rather than string equality — pinning the exact string would make a
      // formatting change look like a broken contract.
      for (const word of ['quick', 'brown', 'fox', 'lazy', 'dog']) {
        expect(transcript, `transcript was: ${transcript}`).toContain(word)
      }
    }, 120_000)
  },
  { requires: ['OPENAI_API_KEY'] },
)

describeLive(
  VOICE,
  'speech to text via Groq',
  () => {
    it('transcribes through the Groq backend when a key is present', async () => {
      // Groq serves a whisper-compatible endpoint, and the plugin treats it as a
      // provider swap. Only the live call proves the swap still matches their API.
      const spoken = await handleTtsRequest({ text: SPOKEN_PHRASE }, config().tts)
      expect(spoken.status).toBe(200)
      const audio = new Uint8Array(await spoken.arrayBuffer())

      const groq = config({ sttProvider: 'groq', sttKey: required('GROQ_API_KEY') })

      const res = await handleSttRequest(
        { audio: { buffer: audio, mimeType: 'audio/mpeg', filename: 'probe.mp3' } },
        groq.stt,
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { transcript?: string }
      expect((body.transcript ?? '').toLowerCase()).toContain('fox')
    }, 120_000)
  },
  // Optional backend: absent GROQ_API_KEY skips this one and leaves OpenAI running.
  { requires: ['OPENAI_API_KEY', 'GROQ_API_KEY'] },
)
