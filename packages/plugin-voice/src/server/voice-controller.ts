import { Body, Post, Req } from '@theokit/http'
import { z } from 'zod'

import type { VoiceConfig } from '../options.js'

import { handleSttRequest, MAX_BODY_BYTES, type SttInput } from './stt-server.js'
import { handleTtsRequest, type TtsInput } from './tts-server.js'

/**
 * Shape of the JSON body `tts` accepts. Exported so an app can widen it in its own schema rather
 * than retype the fields — the same reason the decoration keys are exported consts.
 */
export const ttsInputSchema = z.object({
  text: z.string().min(1),
  voice: z.string().min(1).optional(),
  speed: z.number().min(0.25).max(4).optional(),
})

/**
 * The voice endpoints as a class an application EXTENDS, rather than two handlers it mounts.
 *
 * `handleSttRequest` / `handleTtsRequest` still exist and still work; nothing here replaces them.
 * What this adds is the half a consumer previously wrote by hand and got to write wrong: reading a
 * multipart body into an {@link SttInput}, and rejecting a request with no audio in the shape the
 * rest of the plugin uses (a typed `code`, not a bare string) instead of letting `undefined` reach
 * the provider call.
 *
 * It deliberately carries NO `@Controller` prefix and NO access decoration. Both are the
 * application's to choose, and a base class that made either decision would force every consumer to
 * edit this package to vary it — the closed half of open/closed pointing the wrong way. What is
 * closed here is the behaviour behind the verbs; what is open is where they are mounted, which
 * provider config backs them, and who is allowed to call each one.
 *
 * @example
 * ```ts
 * \@Controller('api/voice')
 * export class VoiceController extends VoiceControllerBase {
 *   protected readonly config = resolveVoiceConfig()
 *
 *   \@UseGuards(AuthGuard)
 *   override tts(body: TtsInput) { return super.tts(body) }
 * }
 * ```
 */
/** Multipart framing and text fields allowed on top of the audio limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const MAX_REQUEST_BYTES = MAX_BODY_BYTES + MULTIPART_OVERHEAD_BYTES

function tooLarge(): Response {
  return Response.json(
    { code: 'PAYLOAD_TOO_LARGE', message: 'request body exceeds the upload limit' },
    { status: 413 },
  )
}

/** Read the body up to `limit` bytes, cancelling the stream once it is passed. `null` means over. */
async function readCappedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export abstract class VoiceControllerBase {
  /** Provider credentials and model choice. The application supplies them; the plugin never reads env. */
  protected abstract readonly config: VoiceConfig

  /**
   * Transcribe an uploaded recording.
   *
   * Takes the whole `Request` rather than a parsed body because the payload is `multipart/form-data`
   * carrying a binary part — and because a request body is a stream that drains once, so a `@Body`
   * on this method would leave nothing for `formData()` to read.
   */
  @Post('stt')
  async stt(@Req() request: Request): Promise<Response> {
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return tooLarge()

    let form: FormData
    try {
      const bytes = await readCappedBody(request, MAX_REQUEST_BYTES)
      if (bytes === null) return tooLarge()
      form = await new Response(bytes, {
        headers: { 'content-type': request.headers.get('content-type') ?? '' },
      }).formData()
    } catch {
      return Response.json(
        { code: 'INVALID_MULTIPART', message: 'expected a multipart/form-data body' },
        { status: 400 },
      )
    }

    const audio = form.get('audio')
    if (!(audio instanceof Blob)) {
      return Response.json(
        { code: 'MISSING_AUDIO', message: 'multipart field "audio" is required' },
        { status: 400 },
      )
    }

    const language = form.get('language')
    const prompt = form.get('prompt')

    return this.transcribe({
      audio,
      language: typeof language === 'string' && language !== '' ? language : undefined,
      prompt: typeof prompt === 'string' && prompt !== '' ? prompt : undefined,
    })
  }

  /** Synthesise speech from text. JSON in, streamed audio out. */
  @Post('tts')
  tts(@Body(ttsInputSchema) body: TtsInput): Promise<Response> {
    return this.synthesise(body)
  }

  /**
   * Seam for a subclass that needs to reach the transcription differently — a different provider per
   * tenant, a usage counter, a cache. Overriding it keeps the multipart parsing and the typed
   * rejections above; replacing `stt` outright does not.
   */
  protected transcribe(input: SttInput): Promise<Response> {
    return handleSttRequest(input, this.config.stt)
  }

  /** Counterpart of {@link transcribe} for synthesis. */
  protected synthesise(input: TtsInput): Promise<Response> {
    return handleTtsRequest(input, this.config.tts)
  }
}
