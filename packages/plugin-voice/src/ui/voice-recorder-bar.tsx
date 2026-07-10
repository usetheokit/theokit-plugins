/**
 * `<VoiceRecorderBar>` — composes `createRecorder()` + STT POST into a
 * single React button that fits into `ChatComposer.leadingActions`.
 *
 * UX state machine (drives the icon + label + button color):
 *   idle        → "Voice" with mic icon
 *   requesting  → spinner; button disabled (waiting on getUserMedia)
 *   recording   → "Stop" with stop icon (red); click to finalize
 *   processing  → spinner; button disabled (POST in flight)
 *   error       → alert below the button + retry icon to clear
 *
 * EC-4 absorbed: `VoicePermissionDeniedError` → renders the auth alert
 *   variant via the internal `<VoiceAlert kind="auth">`. Apps that want
 *   their own design-system alert can pass `renderError`.
 *
 * EC-12 absorbed: the click handler is a no-op while the state is
 *   anything but `idle` / `error`. Combined with the recorder's
 *   in-flight Promise dedup (T3.2), a double-click cannot kick off two
 *   parallel recording sessions.
 *
 * EC-15 documented in README (Browser requirements section).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { VoiceNoDeviceError, VoicePermissionDeniedError, VoicePluginError } from '../errors.js'
import { createRecorder, type CreateRecorderOptions, type Recorder } from '../recorder.js'

import { VoiceAlert, type AlertKind } from './alert.js'
import { MicIcon, RetryIcon, SpinnerIcon, StopIcon } from './icons.js'

export type RecorderBarPhase = 'idle' | 'requesting' | 'recording' | 'processing' | 'error'

export interface VoiceRecorderBarProps {
  /** Called with the upstream transcript on success. */
  onTranscript: (transcript: string, meta: { language?: string; durationMs: number }) => void
  /**
   * Called with the typed error when the recorder, the STT POST, or the
   * upstream provider fails. Useful for toast / analytics integration.
   */
  onError?: (err: VoicePluginError | Error) => void
  /** STT POST target. Defaults to `/api/voice/stt`. */
  sttEndpoint?: string
  /**
   * Multipart field name the server expects. Defaults to `audio` to
   * match `handleSttRequest`.
   */
  fieldName?: string
  /** Optional ISO language hint forwarded to Whisper. */
  language?: string
  /**
   * Render-prop override for the error surface — apps using
   * `@theokit/ui` can render their own `<Alert>` here instead of the
   * internal `<VoiceAlert>`. Returns `null` for default behavior.
   */
  renderError?: (err: VoicePluginError | Error, retry: () => void) => ReactNode
  /** Extra wrapper class for layout integration. */
  className?: string
  /** Override the recorder factory (tests inject a mock). Receives the same
   *  options the bar would pass to `createRecorder` (incl. `onError`). */
  recorderFactory?: (opts?: CreateRecorderOptions) => Recorder
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch
  /** CSRF token header value — defaults to TheoKit's "X-Theo-Action: 1". */
  csrfHeader?: { name: string; value: string }
}

interface ErrorState {
  err: VoicePluginError | Error
  kind: AlertKind
  title: string
  detail?: string
}

const DEFAULT_CSRF_HEADER = { name: 'X-Theo-Action', value: '1' }

export function VoiceRecorderBar({
  onTranscript,
  onError,
  sttEndpoint = '/api/voice/stt',
  fieldName = 'audio',
  language,
  renderError,
  className,
  recorderFactory,
  fetchImpl,
  csrfHeader = DEFAULT_CSRF_HEADER,
}: VoiceRecorderBarProps) {
  const [phase, setPhase] = useState<RecorderBarPhase>('idle')
  const [error, setError] = useState<ErrorState | null>(null)
  const recorderRef = useRef<Recorder | null>(null)

  // Release the underlying media stream tracks on unmount so a navigation
  // away from the chat page does not leave the OS mic indicator on.
  useEffect(() => {
    return () => {
      recorderRef.current?.release()
      recorderRef.current = null
    }
  }, [])

  const surface = useCallback(
    (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err))
      const state = mapErrorToState(e)
      setError(state)
      setPhase('error')
      if (onError !== undefined) onError(state.err)
    },
    [onError],
  )

  const clear = useCallback(() => {
    setError(null)
    setPhase('idle')
  }, [])

  const start = useCallback(async () => {
    // EC-12 belt-and-suspenders: the recorder factory itself dedups in
    // flight starts, but the button must also reject clicks in any
    // non-idle state so the user can't enqueue spurious requests.
    if (phase !== 'idle' && phase !== 'error') return
    setError(null)
    setPhase('requesting')

    let recorder = recorderRef.current
    if (recorder === null) {
      // #F-wire-1: pass onError so a MediaRecorder error mid-recording (no stop
      // pending) surfaces via the bar instead of being silently lost.
      recorder = (recorderFactory ?? createRecorder)({ onError: surface })
      recorderRef.current = recorder
    }

    try {
      await recorder.start()
      setPhase('recording')
    } catch (err) {
      surface(err)
    }
  }, [phase, recorderFactory, surface])

  const stop = useCallback(async () => {
    if (phase !== 'recording') return
    const recorder = recorderRef.current
    if (recorder === null) return
    setPhase('processing')
    try {
      const blob = await recorder.stop()
      const form = new FormData()
      form.append(fieldName, blob, 'voice.webm')
      if (language !== undefined) form.append('language', language)
      const headers: HeadersInit = { [csrfHeader.name]: csrfHeader.value }
      const doFetch = fetchImpl ?? globalThis.fetch
      const res = await doFetch(sttEndpoint, {
        method: 'POST',
        headers,
        body: form,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new VoicePluginError(`STT endpoint returned ${res.status}: ${text.slice(0, 200)}`)
      }
      // #217: a 200 response with a malformed body would otherwise throw an
      // opaque SyntaxError. Guard res.json() and surface a specific error.
      let data: { transcript?: string; language?: string; durationMs?: number }
      try {
        data = (await res.json()) as {
          transcript?: string
          language?: string
          durationMs?: number
        }
      } catch (parseErr) {
        throw new VoicePluginError(
          'Invalid STT response: the server returned a body that is not valid JSON.',
          { cause: parseErr },
        )
      }
      const transcript = data.transcript ?? ''
      const meta: { language?: string; durationMs: number } = {
        durationMs: data.durationMs ?? 0,
      }
      if (data.language !== undefined) meta.language = data.language
      onTranscript(transcript, meta)
      setPhase('idle')
    } catch (err) {
      surface(err)
    }
  }, [phase, fieldName, language, sttEndpoint, csrfHeader, fetchImpl, onTranscript, surface])

  const isBusy = phase === 'requesting' || phase === 'processing'
  const isRecording = phase === 'recording'
  const isError = phase === 'error'

  const onClick = () => {
    if (isError) {
      clear()
      return
    }
    if (isRecording) {
      void stop()
      return
    }
    if (phase === 'idle') {
      void start()
    }
  }

  const label = isError
    ? 'Retry'
    : isRecording
      ? 'Stop'
      : phase === 'requesting'
        ? 'Requesting mic…'
        : phase === 'processing'
          ? 'Transcribing…'
          : 'Voice'

  const Icon = isError ? RetryIcon : isRecording ? StopIcon : isBusy ? SpinnerIcon : MicIcon

  return (
    <div className={['inline-flex flex-col gap-1', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        onClick={onClick}
        disabled={isBusy}
        aria-pressed={isRecording}
        aria-label={label}
        data-testid="voice-recorder-button"
        data-phase={phase}
        className={[
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isRecording
            ? 'border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300'
            : isError
              ? 'border-red-500/40 bg-card text-red-700 hover:bg-red-500/10 dark:text-red-300'
              : 'border-border/60 bg-card text-foreground hover:bg-muted disabled:opacity-60',
        ].join(' ')}
      >
        <Icon className="size-3.5" aria-hidden />
        {label}
      </button>
      {isError && error !== null ? (
        renderError !== undefined ? (
          renderError(error.err, clear)
        ) : (
          <VoiceAlert kind={error.kind} title={error.title}>
            {error.detail}
          </VoiceAlert>
        )
      ) : null}
    </div>
  )
}

function mapErrorToState(err: Error): ErrorState {
  if (err instanceof VoicePermissionDeniedError) {
    return {
      err,
      kind: 'auth',
      title: 'Microphone access denied',
      detail:
        'Allow microphone access in your browser to record. Click the lock icon in the address bar → Site permissions → Microphone.',
    }
  }
  if (err instanceof VoiceNoDeviceError) {
    return {
      err,
      kind: 'device',
      title: 'No microphone detected',
      detail: 'Plug in a microphone or choose one in your operating system settings, then retry.',
    }
  }
  if (err instanceof VoicePluginError) {
    return { err, kind: 'upstream', title: 'Voice service error', detail: err.message }
  }
  return { err, kind: 'generic', title: 'Unexpected voice error', detail: err.message }
}
