/**
 * Browser-side audio capture for @theokit/plugin-voice.
 *
 * Wraps `navigator.mediaDevices.getUserMedia` + `MediaRecorder` behind a
 * small Recorder interface so consumers don't need to know about Web
 * Audio quirks. The recorder returns a single `Blob` on stop — fed to
 * `/api/voice/stt` as multipart/form-data by the UI bar.
 *
 * EC-4 absorbed: `DOMException` produced by the browser carries a
 * `.name` field that we map to typed plugin errors. The UI layer
 * (`VoiceRecorderBar`, T3.4) `catch`es these and renders actionable
 * alerts instead of opaque DOMException dumps.
 *
 * EC-12 absorbed (partial — full guard ships with the UI in T3.4):
 * `start()` returns the same in-flight Promise if called while a start
 * is already pending, so a double-click cannot allocate two parallel
 * MediaRecorder instances. The state machine remains single-threaded.
 *
 * EC-15 absorbed: `getUserMedia` is only available in secure contexts
 * (HTTPS or `localhost`). Outside a secure context the browser returns
 * `undefined` for `navigator.mediaDevices`; we surface this as
 * `VoicePluginConfigError` with a hint to read the README.
 *
 * Design choice — `MediaRecorder` over Web Audio + PCM16:
 * the OpenClaw realtime stack uses raw PCM16 over WebSocket because it
 * streams partial transcripts back. For the batch MVP we only need
 * "record full clip → POST → transcript". `MediaRecorder` produces an
 * already-compressed `audio/webm` blob (Opus or codecs:opus), which is
 * accepted by both OpenAI and Groq Whisper REST endpoints without
 * re-encoding, and keeps the wire payload an order of magnitude smaller
 * than raw PCM. The realtime path is deferred to a follow-up version.
 */

import {
  VoiceNoDeviceError,
  VoicePermissionDeniedError,
  VoicePluginConfigError,
  VoicePluginError,
} from './errors.js'

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'processing' | 'stopped'

/**
 * A microphone recording session.
 *
 * `release()` is separate from `stop()` and matters: stopping yields the audio, but the browser
 * keeps showing the recording indicator until the media tracks are released. It is idempotent, so
 * calling it from both a cleanup effect and an error path is safe.
 */
export interface Recorder {
  start(): Promise<void>
  stop(): Promise<Blob>
  state(): RecorderState
  /** Release the underlying media stream tracks. Idempotent. */
  release(): void
}

/**
 * Options for {@link createRecorder}. Every field is a hint the browser may ignore.
 *
 * `mimeType` in particular is a request, not a guarantee — the recorded blob's own `.type` is what
 * actually got produced, and that is the value to send upstream.
 */
export interface CreateRecorderOptions {
  /**
   * Desired audio MIME. Browsers may downgrade — the final blob's
   * `.type` is authoritative. Defaults to "audio/webm;codecs=opus".
   */
  mimeType?: string
  /**
   * Audio bitrate hint (browser may ignore). Defaults to 96_000 bps,
   * which is the upper bound recommended by Whisper docs for
   * single-speaker English.
   */
  audioBitsPerSecond?: number
  /**
   * Audio track constraints — forwarded to `getUserMedia`. Defaults to
   * `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }`.
   */
  audioConstraints?: MediaTrackConstraints
  /**
   * Called when the MediaRecorder fires an `error` while recording with no
   * `stop()` in flight (#213). Without this, such an error would be dropped and
   * the media stream leaked. Errors during `stop()` still reject the `stop()`
   * promise as before.
   */
  onError?: (err: VoicePluginError) => void
}

const DEFAULT_MIME = 'audio/webm;codecs=opus'
const DEFAULT_BITRATE = 96_000
const DEFAULT_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/**
 * Create a microphone recorder over the browser's MediaRecorder.
 *
 * Options are resolved at construction, so an unusable configuration fails here rather than at the
 * moment the user presses record — the same fail-fast stance the server handlers take.
 */
export function createRecorder(opts: CreateRecorderOptions = {}): Recorder {
  // Capture options once so config errors surface at factory call time
  // (lined up with the server-side EC-6 fail-fast policy).
  const mimeType = opts.mimeType ?? DEFAULT_MIME
  const audioBitsPerSecond = opts.audioBitsPerSecond ?? DEFAULT_BITRATE
  const audioConstraints = opts.audioConstraints ?? DEFAULT_CONSTRAINTS
  const onError = opts.onError

  let state: RecorderState = 'idle'
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let chunks: BlobPart[] = []
  let startPromise: Promise<void> | null = null
  let stopResolve: ((blob: Blob) => void) | null = null
  let stopReject: ((reason: unknown) => void) | null = null

  function ensureSecureContext(): void {
    // EC-15: `navigator.mediaDevices` is undefined in non-secure contexts.
    // Treat absence as a configuration error so the consumer sees a clear
    // message instead of "Cannot read property 'getUserMedia' of undefined".
    const md = (globalThis as { navigator?: Navigator }).navigator?.mediaDevices
    if (md === undefined) {
      throw new VoicePluginConfigError(
        '@theokit/plugin-voice: navigator.mediaDevices is undefined. Voice capture requires a secure context (HTTPS or localhost). See @theokit/plugin-voice README → Browser requirements.',
      )
    }
    if (typeof md.getUserMedia !== 'function') {
      throw new VoicePluginConfigError(
        '@theokit/plugin-voice: navigator.mediaDevices.getUserMedia is missing. The current browser is too old to support voice capture.',
      )
    }
    const mr = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
    if (mr === undefined) {
      throw new VoicePluginConfigError(
        '@theokit/plugin-voice: MediaRecorder API is not available in this browser.',
      )
    }
  }

  async function doStart(): Promise<void> {
    state = 'requesting'
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      stream = acquired
    } catch (err) {
      state = 'idle'
      throw mapMediaError(err)
    }

    chunks = []
    try {
      const mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond })
      recorder = mr
      mr.addEventListener('dataavailable', (event: BlobEvent) => {
        // `event.data.size` can be 0 between segments — keep them out
        // to avoid empty Blob parts breaking downstream MIME inspection.
        if (event.data.size > 0) chunks.push(event.data)
      })
      mr.addEventListener('error', (event: Event) => {
        // Browsers fire MediaRecorder.error with a DOMException attached.
        const ex = (event as unknown as { error?: unknown }).error
        const mapped = mapMediaError(ex)
        state = 'idle'
        // #213: ALWAYS release the stream on error — not only when a stop() is
        // pending — so an in-recording failure cannot leak the media tracks.
        releaseStream()
        if (stopReject) {
          // An error during stop() rejects the pending stop() promise.
          stopReject(mapped)
        } else {
          // An error during recording (no stop pending) was previously dropped;
          // surface it via onError so the consumer can react (#213).
          onError?.(mapped)
        }
      })
      mr.addEventListener('stop', () => {
        const finalBlob = new Blob(chunks, { type: mimeType })
        chunks = []
        state = 'stopped'
        if (stopResolve) {
          stopResolve(finalBlob)
          stopResolve = null
          stopReject = null
        }
      })
      mr.start()
      state = 'recording'
    } catch (err) {
      // MediaRecorder constructor failure (unsupported MIME etc).
      state = 'idle'
      releaseStream()
      throw mapMediaError(err)
    }
  }

  function start(): Promise<void> {
    // EC-12 partial: dedupe concurrent starts. The first caller drives
    // the request; any subsequent caller awaits the same Promise.
    if (state === 'recording') return Promise.resolve()
    if (startPromise !== null) return startPromise
    // ensureSecureContext throws synchronously; route the throw through
    // the Promise contract so callers can use a single `.catch` and our
    // tests can `await expect(...).rejects.toBe...`.
    try {
      ensureSecureContext()
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
    startPromise = doStart().finally(() => {
      startPromise = null
    })
    return startPromise
  }

  function stop(): Promise<Blob> {
    if (state !== 'recording') {
      return Promise.reject(
        new VoicePluginError(
          `stop() called in state "${state}"; recorder must be "recording" first.`,
        ),
      )
    }
    state = 'processing'
    const promise = new Promise<Blob>((resolve, reject) => {
      stopResolve = (blob) => {
        releaseStream()
        resolve(blob)
      }
      stopReject = (reason) => {
        releaseStream()
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      }
    })
    try {
      recorder?.stop()
    } catch (err) {
      state = 'idle'
      releaseStream()
      return Promise.reject(mapMediaError(err))
    }
    return promise
  }

  function release(): void {
    releaseStream()
    recorder = null
    chunks = []
    state = 'idle'
  }

  function releaseStream(): void {
    if (stream !== null) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      stream = null
    }
  }

  return {
    start,
    stop,
    state: () => state,
    release,
  }
}

/**
 * Map a `DOMException` from MediaDevices into the typed plugin error
 * hierarchy. EC-4: tests assert the exact subclass — never refactor to
 * return the bare DOMException.
 *
 * Unknown errors fall back to `VoicePluginError` with the original
 * preserved as `cause` so diagnostic logs keep the full stack.
 */
function mapMediaError(err: unknown): VoicePluginError {
  if (err instanceof VoicePluginError) return err
  const name = readErrorName(err)
  const message = readErrorMessage(err)
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new VoicePermissionDeniedError(
        `Microphone permission denied (${name}). Ask the user to allow microphone access in the browser's site settings.`,
        { cause: err },
      )
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new VoiceNoDeviceError(
        `No usable microphone device (${name}). Plug in a mic or change the input device in the OS settings.`,
        { cause: err },
      )
    case 'NotReadableError':
      return new VoicePluginError(`Microphone is in use by another application (${name}).`, {
        cause: err,
      })
    default:
      return new VoicePluginError(
        `MediaDevices error${name === '' ? '' : ` (${name})`}: ${message}`,
        { cause: err },
      )
  }
}

function readErrorName(err: unknown): string {
  if (err === null || typeof err !== 'object') return ''
  const candidate = (err as { name?: unknown }).name
  return typeof candidate === 'string' ? candidate : ''
}

function readErrorMessage(err: unknown): string {
  if (err === null || typeof err !== 'object') return String(err)
  const candidate = (err as { message?: unknown }).message
  return typeof candidate === 'string' ? candidate : 'unknown error'
}
