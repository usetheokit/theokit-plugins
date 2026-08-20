/**
 * `useTts(options)` — browser-side React hook that POSTs text to the
 * `/api/voice/tts` endpoint, decodes the returned `audio/mpeg` stream
 * via the `HTMLAudioElement` API, and exposes a 4-state phase
 * (`idle | requesting | playing | error`) so consumers can render a
 * speak button and a stop button without owning the audio plumbing.
 *
 * Cleanup contract:
 *   - calling `speak()` while another clip is playing aborts the
 *     previous fetch + revokes its blob URL before starting the new one
 *   - calling `stop()` pauses the current clip and resets phase to idle
 *   - unmounting the consumer calls `stop()` in the effect cleanup so
 *     the user does not hear orphaned audio after navigating away
 *
 * CSRF: the default header `X-Theo-Action: 1` matches TheoKit's strict
 * CSRF mode (post-0.3.0 cutover). Pass `csrfHeader: undefined` to opt
 * out for non-TheoKit consumers.
 *
 * Errors map to typed `VoicePluginError` subclasses when possible
 * (provider errors get `VoiceProviderError` with the HTTP status).
 * Anything else surfaces as the base class so the consumer can switch
 * on `instanceof` without losing diagnostic detail.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { VoicePluginError, VoiceProviderError } from '../errors.js'

/**
 * Where a speech request is.
 *
 * `'requesting'` and `'playing'` are separate because they need different UI — a spinner while the
 * provider synthesises, a stop control once audio is actually running.
 */
export type UseTtsPhase = 'idle' | 'requesting' | 'playing' | 'error'

/**
 * Options for {@link useTts}.
 *
 * `voice` and `speed` are defaults each `speak()` may override. `csrfHeader` defaults to TheoKit's
 * strict-mode pair and takes `null` to opt out explicitly, so disabling CSRF is always a decision
 * someone wrote down rather than a field they forgot.
 */
export interface UseTtsOptions {
  /** Endpoint to POST to. Defaults to `/api/voice/tts`. */
  endpoint?: string
  /** Default voice. Can be overridden per `speak()` call. */
  voice?: string
  /** Default speed [0.25, 4.0]. Can be overridden per `speak()` call. */
  speed?: number
  /**
   * CSRF header pair attached to every request. Default matches TheoKit
   * strict mode (`X-Theo-Action: 1`). Pass `null` to disable (e.g. when
   * the endpoint sits behind a CORS-permissive subdomain that does not
   * need CSRF).
   */
  csrfHeader?: { name: string; value: string } | null
  /** Test seam for `fetch`. */
  fetchImpl?: typeof fetch
  /** Test seam for the audio constructor. */
  audioFactory?: () => HTMLAudioElement
  /** Called once the audio finishes playing (or is stopped). */
  onEnded?: () => void
  /** Called when speech transitions into error state. */
  onError?: (err: VoicePluginError | Error) => void
}

/** Per-call overrides for {@link UseTtsState.speak}, taking precedence over the hook's defaults. */
export interface UseTtsSpeakOptions {
  voice?: string
  speed?: number
}

/**
 * What {@link useTts} returns: `speak`, `stop`, the current phase, and the last error.
 *
 * `speak` resolves when playback ends rather than when the request returns, so a caller can await a
 * line finishing before saying the next one.
 */
export interface UseTtsState {
  /** POST the text + start playback. Resolves when playback ends. */
  speak: (text: string, opts?: UseTtsSpeakOptions) => Promise<void>
  /** Stop the current clip, revoke its blob URL, return to idle. */
  stop: () => void
  phase: UseTtsPhase
  error: VoicePluginError | Error | null
}

const DEFAULT_CSRF_HEADER = { name: 'X-Theo-Action', value: '1' }

/**
 * Speak text through the configured endpoint and play the result.
 *
 * `stop()` revokes the clip's blob URL as well as halting playback: without that, every utterance in
 * a long session would hold its audio in memory until the page was reloaded.
 */
export function useTts(options: UseTtsOptions = {}): UseTtsState {
  const {
    endpoint = '/api/voice/tts',
    voice: defaultVoice,
    speed: defaultSpeed,
    fetchImpl,
    audioFactory,
    onEnded,
    onError,
  } = options
  // `undefined` falls back to the TheoKit default; `null` disables.
  const csrfHeader: { name: string; value: string } | null =
    options.csrfHeader === undefined ? DEFAULT_CSRF_HEADER : options.csrfHeader

  const [phase, setPhase] = useState<UseTtsPhase>('idle')
  const [error, setError] = useState<VoicePluginError | Error | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const onEndedRef = useRef(onEnded)
  const onErrorRef = useRef(onError)
  onEndedRef.current = onEnded
  onErrorRef.current = onError

  const cleanupAudio = useCallback(() => {
    const audio = audioRef.current
    if (audio !== null) {
      audio.pause()
      try {
        audio.src = ''
      } catch {
        // some implementations throw when clearing src mid-load — safe to swallow.
      }
      audioRef.current = null
    }
    if (blobUrlRef.current !== null) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    cleanupAudio()
    setPhase('idle')
    setError(null)
  }, [cleanupAudio])

  const speak = useCallback(
    async (text: string, callOpts: UseTtsSpeakOptions = {}) => {
      if (typeof text !== 'string' || text.length === 0) return
      // Abort + clean up any in-flight playback before starting fresh.
      stop()
      const controller = new AbortController()
      abortRef.current = controller
      // #216: a newer speak()/stop() reassigns abortRef. After every await we
      // check identity — not just signal.aborted — so a stale call that resolves
      // late never overrides the newer call's state or shared refs.
      const isStale = (): boolean => abortRef.current !== controller
      setError(null)
      setPhase('requesting')

      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (csrfHeader !== null) headers[csrfHeader.name] = csrfHeader.value
      const body: Record<string, unknown> = { text }
      const voice = callOpts.voice ?? defaultVoice
      const speed = callOpts.speed ?? defaultSpeed
      if (voice !== undefined) body.voice = voice
      if (speed !== undefined) body.speed = speed

      let res: Response
      try {
        res = await (fetchImpl ?? globalThis.fetch)(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (err) {
        // #216: own-signal abort OR superseded-by-newer-call → bail silently.
        if (controller.signal.aborted || isStale()) return
        const wrapped =
          err instanceof Error
            ? new VoicePluginError(`TTS network failure: ${err.message}`, { cause: err })
            : new VoicePluginError('TTS network failure: unknown')
        setError(wrapped)
        setPhase('error')
        onErrorRef.current?.(wrapped)
        return
      }

      // #216: a newer call superseded us while the fetch was in flight.
      if (isStale()) return

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const wrapped = new VoiceProviderError(
          'openai',
          res.status,
          `TTS endpoint returned ${res.status}: ${text.slice(0, 200)}`,
        )
        setError(wrapped)
        setPhase('error')
        onErrorRef.current?.(wrapped)
        return
      }

      let blob: Blob
      try {
        blob = await res.blob()
      } catch (err) {
        const wrapped =
          err instanceof Error
            ? new VoicePluginError(`TTS body read failure: ${err.message}`, { cause: err })
            : new VoicePluginError('TTS body read failure: unknown')
        setError(wrapped)
        setPhase('error')
        onErrorRef.current?.(wrapped)
        return
      }
      if (isStale()) return

      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url
      const audio = (audioFactory ?? (() => new Audio()))()
      audio.src = url
      audioRef.current = audio

      const handleEnded = () => {
        cleanupAudio()
        setPhase('idle')
        onEndedRef.current?.()
      }
      const handleError = () => {
        const wrapped = new VoicePluginError('Audio playback failed.')
        cleanupAudio()
        setError(wrapped)
        setPhase('error')
        onErrorRef.current?.(wrapped)
      }
      audio.addEventListener('ended', handleEnded)
      audio.addEventListener('error', handleError)

      try {
        await audio.play()
        // #216: if a newer speak()/stop() took over while play() was resolving,
        // do NOT flip phase or touch the shared refs (they belong to the newer
        // call). Tear down only THIS call's own audio + url + listeners.
        if (isStale()) {
          audio.removeEventListener('ended', handleEnded)
          audio.removeEventListener('error', handleError)
          audio.pause()
          URL.revokeObjectURL(url)
          return
        }
        setPhase('playing')
      } catch (err) {
        // Browsers reject `play()` when there is no user gesture; surface
        // as a typed error so the UI can prompt the user to interact.
        const wrapped =
          err instanceof Error
            ? new VoicePluginError(`Audio.play() rejected: ${err.message}`, { cause: err })
            : new VoicePluginError('Audio.play() rejected: unknown')
        cleanupAudio()
        setError(wrapped)
        setPhase('error')
        onErrorRef.current?.(wrapped)
      }
    },
    [audioFactory, cleanupAudio, csrfHeader, defaultSpeed, defaultVoice, endpoint, fetchImpl, stop],
  )

  // Stop the audio when the consumer unmounts so a navigation away does
  // not leave an orphaned clip playing.
  useEffect(() => {
    return () => stop()
  }, [stop])

  return { speak, stop, phase, error }
}
