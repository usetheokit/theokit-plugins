/**
 * @vitest-environment jsdom
 *
 * Tests for `<VoiceRecorderBar>` covering the plan's TDD checklist:
 *   - bar_toggles_recording_state
 *   - transcript_propagates_to_handler
 *   - error_state_renders_red_indicator
 *   - permission_denied_renders_auth_alert (EC-4)
 *   - ignores_duplicate_start (EC-12)
 *
 * The recorder is injected via `recorderFactory` to keep the test from
 * touching real MediaDevices APIs. The STT fetch is injected via
 * `fetchImpl`.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoicePermissionDeniedError, VoicePluginError } from '../src/errors.js'
import type { Recorder } from '../src/recorder.js'
import { VoiceRecorderBar } from '../src/ui/voice-recorder-bar.js'

function fakeRecorder(overrides: Partial<Recorder> = {}): Recorder & {
  resolveStop: (blob: Blob) => void
  rejectStop: (err: unknown) => void
  startSpy: ReturnType<typeof vi.fn>
} {
  let resolveStop: (blob: Blob) => void = () => undefined
  let rejectStop: (err: unknown) => void = () => undefined
  let phase: 'idle' | 'recording' | 'stopped' = 'idle'
  const startSpy = vi.fn(() => {
    phase = 'recording'
    return Promise.resolve()
  })
  return {
    start: startSpy,
    startSpy,
    stop: vi.fn(
      () =>
        new Promise<Blob>((resolve, reject) => {
          resolveStop = (blob) => {
            phase = 'stopped'
            resolve(blob)
          }
          rejectStop = reject
        }),
    ),
    state: () => phase,
    release: vi.fn(),
    resolveStop: (blob) => resolveStop(blob),
    rejectStop: (err) => rejectStop(err),
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('T3.4 — VoiceRecorderBar', () => {
  it('bar_toggles_recording_state — idle → recording → idle', async () => {
    const rec = fakeRecorder()
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ transcript: 'hi', durationMs: 100 })),
    )
    const onTranscript = vi.fn()
    render(
      <VoiceRecorderBar
        onTranscript={onTranscript}
        recorderFactory={() => rec}
        fetchImpl={fetchImpl}
      />,
    )

    const btn = screen.getByTestId('voice-recorder-button')
    expect(btn.getAttribute('data-phase')).toBe('idle')

    act(() => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('recording'))
    expect(rec.startSpy).toHaveBeenCalledOnce()

    act(() => {
      fireEvent.click(btn)
    })
    // The bar is now waiting on the recorder.stop() promise we control
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('processing'))

    act(() => {
      rec.resolveStop(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }))
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('idle'))
  })

  it('transcript_propagates_to_handler with language + durationMs metadata', async () => {
    const rec = fakeRecorder()
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ transcript: 'olá mundo', language: 'pt', durationMs: 423 })),
    )
    const onTranscript = vi.fn()
    render(
      <VoiceRecorderBar
        onTranscript={onTranscript}
        recorderFactory={() => rec}
        fetchImpl={fetchImpl}
      />,
    )
    const btn = screen.getByTestId('voice-recorder-button')

    act(() => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('recording'))
    act(() => {
      fireEvent.click(btn)
    })
    act(() => {
      rec.resolveStop(new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
    })

    await waitFor(() => expect(onTranscript).toHaveBeenCalled())
    expect(onTranscript).toHaveBeenCalledWith('olá mundo', { language: 'pt', durationMs: 423 })
  })

  it('sends FormData to the STT endpoint with CSRF header by default', async () => {
    const rec = fakeRecorder()
    let capturedInit: RequestInit | null = null
    const fetchImpl = vi.fn((_url: string | URL, init: RequestInit) => {
      capturedInit = init
      return Promise.resolve(jsonResponse({ transcript: 'x', durationMs: 1 }))
    })
    render(
      <VoiceRecorderBar
        onTranscript={() => undefined}
        recorderFactory={() => rec}
        fetchImpl={fetchImpl}
      />,
    )
    const btn = screen.getByTestId('voice-recorder-button')
    act(() => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('recording'))
    act(() => {
      fireEvent.click(btn)
    })
    act(() => {
      rec.resolveStop(new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
    })

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(capturedInit?.method).toBe('POST')
    const headers = (capturedInit?.headers ?? {}) as Record<string, string>
    expect(headers['X-Theo-Action']).toBe('1')
    expect(capturedInit?.body).toBeInstanceOf(FormData)
  })

  it('permission_denied_renders_auth_alert (EC-4) and routes through onError', async () => {
    const rec = fakeRecorder({
      start: vi.fn(() => Promise.reject(new VoicePermissionDeniedError('denied'))),
    })
    const onError = vi.fn()
    render(
      <VoiceRecorderBar
        onTranscript={() => undefined}
        recorderFactory={() => rec}
        onError={onError}
      />,
    )

    const btn = screen.getByTestId('voice-recorder-button')
    act(() => {
      fireEvent.click(btn)
    })

    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('error'))
    const alert = screen.getByTestId('voice-alert')
    expect(alert.getAttribute('data-kind')).toBe('auth')
    expect(alert.textContent).toMatch(/Microphone access denied/i)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(VoicePermissionDeniedError)
  })

  it('error_state_renders_red_indicator and click_retry clears the error', async () => {
    const rec = fakeRecorder({
      start: vi.fn(() => Promise.reject(new VoicePluginError('boom'))),
    })
    render(<VoiceRecorderBar onTranscript={() => undefined} recorderFactory={() => rec} />)

    const btn = screen.getByTestId('voice-recorder-button')
    act(() => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('error'))
    expect(screen.getByTestId('voice-alert')).toBeTruthy()

    // Retry click — clears the alert and returns to idle without
    // starting a new recording (user must click again to record).
    act(() => {
      fireEvent.click(btn)
    })
    expect(btn.getAttribute('data-phase')).toBe('idle')
    expect(screen.queryByTestId('voice-alert')).toBeNull()
  })

  it('ignores_duplicate_start (EC-12) — extra clicks while requesting are no-op', async () => {
    let resolveStart: () => void = () => undefined
    const startSpy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve
        }),
    )
    const rec = fakeRecorder({ start: startSpy })
    render(<VoiceRecorderBar onTranscript={() => undefined} recorderFactory={() => rec} />)
    const btn = screen.getByTestId('voice-recorder-button')

    act(() => {
      fireEvent.click(btn)
    })
    // While the start promise is pending, additional clicks must be a
    // no-op. The bar disables the button during `requesting`.
    expect(btn.hasAttribute('disabled')).toBe(true)
    act(() => {
      fireEvent.click(btn)
      fireEvent.click(btn)
      fireEvent.click(btn)
    })
    expect(startSpy).toHaveBeenCalledOnce()

    act(() => {
      resolveStart()
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('recording'))
  })

  it('STT non-2xx surfaces as upstream alert (renderError default)', async () => {
    const rec = fakeRecorder()
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('Unauthorized', { status: 401 })))
    render(
      <VoiceRecorderBar
        onTranscript={() => undefined}
        recorderFactory={() => rec}
        fetchImpl={fetchImpl}
      />,
    )
    const btn = screen.getByTestId('voice-recorder-button')
    act(() => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('recording'))
    act(() => {
      fireEvent.click(btn)
    })
    act(() => {
      rec.resolveStop(new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
    })

    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('error'))
    const alert = screen.getByTestId('voice-alert')
    expect(alert.getAttribute('data-kind')).toBe('upstream')
  })

  it('renderError prop wins over the default <VoiceAlert>', async () => {
    const rec = fakeRecorder({
      start: vi.fn(() => Promise.reject(new VoicePermissionDeniedError('denied'))),
    })
    render(
      <VoiceRecorderBar
        onTranscript={() => undefined}
        recorderFactory={() => rec}
        renderError={(err) => <div data-testid="custom-alert">{err.message}</div>}
      />,
    )
    const btn = screen.getByTestId('voice-recorder-button')
    act(() => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(screen.getByTestId('custom-alert')).toBeTruthy())
    expect(screen.queryByTestId('voice-alert')).toBeNull()
  })

  it('test_malformed_stt_response_surfaces_specific_error (#217)', async () => {
    const rec = fakeRecorder()
    // 200 OK but the body is NOT valid JSON — res.json() throws opaquely.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response('<<not json>>', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const onError = vi.fn()
    render(
      <VoiceRecorderBar
        onTranscript={() => undefined}
        onError={onError}
        recorderFactory={() => rec}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    )
    const btn = screen.getByTestId('voice-recorder-button')
    await act(async () => {
      fireEvent.click(btn)
      await Promise.resolve()
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('recording'))
    await act(async () => {
      fireEvent.click(btn)
      await Promise.resolve()
    })
    await act(async () => {
      rec.resolveStop(new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
      await Promise.resolve()
    })

    await waitFor(() => expect(onError).toHaveBeenCalled())
    const err = onError.mock.calls[0]![0] as Error
    expect(err).toBeInstanceOf(VoicePluginError)
    expect(String(err.message)).toMatch(/invalid stt response/i)
  })

  it('test_in_recording_error_surfaces_via_onError (#F-wire-1)', async () => {
    // #F-wire-1: a MediaRecorder error mid-recording (no stop pending) must
    // surface via the bar's onError + set phase=error. The bar must pass its
    // onError handler to createRecorder — proven by the injected factory
    // receiving opts.onError. Pre-fix the bar called createRecorder() with no
    // args, so capturedOnError stays undefined → this test is RED.
    let capturedOnError: ((err: VoicePluginError) => void) | undefined
    const rec = fakeRecorder()
    const onError = vi.fn()
    render(
      <VoiceRecorderBar
        onTranscript={() => undefined}
        onError={onError}
        recorderFactory={(opts?: { onError?: (e: VoicePluginError) => void }) => {
          capturedOnError = opts?.onError
          return rec
        }}
      />,
    )
    const btn = screen.getByTestId('voice-recorder-button')
    await act(async () => {
      fireEvent.click(btn)
      await Promise.resolve()
    })
    await waitFor(() => expect(btn.getAttribute('data-phase')).toBe('recording'))

    // The recorder reports an in-recording error through the wired onError.
    await act(async () => {
      capturedOnError?.(new VoicePluginError('hardware failure mid-recording'))
      await Promise.resolve()
    })

    expect(capturedOnError).toBeTypeOf('function') // bar wired onError into createRecorder
    expect(onError).toHaveBeenCalledOnce()
    expect(btn.getAttribute('data-phase')).toBe('error')
  })
})
