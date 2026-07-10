/**
 * @vitest-environment jsdom
 *
 * Browser-side recorder unit tests. jsdom does NOT ship a real
 * MediaRecorder or navigator.mediaDevices — we install minimal mocks
 * before each test and assert the error mapping (EC-4) + concurrency
 * dedup (EC-12) + state machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  VoiceNoDeviceError,
  VoicePermissionDeniedError,
  VoicePluginConfigError,
  VoicePluginError,
  createRecorder,
} from '../src/index.js'

interface FakeStream {
  getTracks(): { stop: ReturnType<typeof vi.fn> }[]
}

interface FakeMediaRecorderConstructor {
  new (stream: MediaStream, opts?: MediaRecorderOptions): FakeMediaRecorder
  __lastInstance: FakeMediaRecorder | null
  __reset(): void
}

interface FakeMediaRecorder {
  start(): void
  stop(): void
  state: string
  addEventListener(type: string, listener: (ev: unknown) => void): void
  emitData(payload: Blob): void
  emitStop(): void
  emitError(err: unknown): void
}

function makeFakeStream(): FakeStream {
  // Tracks are cached so repeated getTracks() calls (one from the test
  // setup, one inside `release()`) return the SAME vi.fn() spies — the
  // assertion would otherwise check a brand-new mock that was never
  // touched by the recorder.
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
  return {
    getTracks: () => tracks,
  }
}

function installMediaDevices(handler: () => Promise<unknown>): ReturnType<typeof vi.fn> {
  const getUserMedia = vi.fn(handler)
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  return getUserMedia
}

function installMediaRecorder(): FakeMediaRecorderConstructor {
  const listeners = new Map<string, Set<(ev: unknown) => void>>()
  // stop() does NOT auto-emit the 'stop' event so tests can drive the
  // ordering explicitly. Real browsers fire `stop` after stop() returns,
  // typically asynchronously — tests that want completion call
  // `instance.emitStop()`; tests that want an error-during-stop call
  // `instance.emitError(...)` BEFORE emitStop.
  const instance: FakeMediaRecorder = {
    start: vi.fn(),
    stop: vi.fn(),
    state: 'inactive',
    addEventListener(type, listener) {
      let set = listeners.get(type)
      if (set === undefined) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(listener)
    },
    emitData(payload: Blob) {
      const fn = Array.from(listeners.get('dataavailable') ?? [])
      for (const f of fn) f({ data: payload })
    },
    emitStop() {
      const fn = Array.from(listeners.get('stop') ?? [])
      for (const f of fn) f({})
    },
    emitError(err: unknown) {
      const fn = Array.from(listeners.get('error') ?? [])
      for (const f of fn) f({ error: err })
    },
  }
  const ctor = function MediaRecorder() {
    ctor.__lastInstance = instance
    return instance
  } as unknown as FakeMediaRecorderConstructor
  ctor.__lastInstance = null
  ctor.__reset = () => {
    ctor.__lastInstance = null
    instance.state = 'inactive'
    listeners.clear()
  }
  ;(globalThis as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder =
    ctor as unknown as typeof MediaRecorder
  return ctor
}

function makeDomException(name: string, message: string): Error {
  const err = new Error(message)
  ;(err as { name: string }).name = name
  return err
}

afterEach(() => {
  // Wipe globals so each test starts clean.
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: undefined,
  })
  delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
  vi.restoreAllMocks()
})

describe('T3.2 — createRecorder (EC-4 + EC-12 + EC-15)', () => {
  describe('happy path', () => {
    let mr: FakeMediaRecorderConstructor

    beforeEach(() => {
      installMediaDevices(() => Promise.resolve(makeFakeStream()))
      mr = installMediaRecorder()
    })

    it('start → recording → stop returns a Blob with the configured MIME type', async () => {
      const recorder = createRecorder()
      expect(recorder.state()).toBe('idle')
      await recorder.start()
      expect(recorder.state()).toBe('recording')

      const instance = mr.__lastInstance
      expect(instance).not.toBeNull()
      instance?.emitData(new Blob(['chunk-1'], { type: 'audio/webm' }))
      instance?.emitData(new Blob(['chunk-2'], { type: 'audio/webm' }))

      const stopPromise = recorder.stop()
      instance?.emitStop()
      const blob = await stopPromise
      expect(blob.type).toBe('audio/webm;codecs=opus')
      expect(blob.size).toBeGreaterThan(0)
      expect(recorder.state()).toBe('stopped')
    })

    it('release() stops all media tracks (cleanup)', async () => {
      // Use a fresh stream + tracks pair so the assertion observes the
      // same vi.fn() spies the recorder closed over.
      const fakeStream = makeFakeStream()
      installMediaDevices(() => Promise.resolve(fakeStream))
      installMediaRecorder()
      const recorder = createRecorder()
      await recorder.start()
      recorder.release()
      const tracks = fakeStream.getTracks()
      for (const t of tracks) {
        expect(t.stop).toHaveBeenCalledOnce()
      }
    })
  })

  describe('EC-4 — error mapping (DOMException → typed errors)', () => {
    it('NotAllowedError → VoicePermissionDeniedError', async () => {
      installMediaDevices(() => Promise.reject(makeDomException('NotAllowedError', 'user denied')))
      installMediaRecorder()
      const recorder = createRecorder()
      await expect(recorder.start()).rejects.toBeInstanceOf(VoicePermissionDeniedError)
      expect(recorder.state()).toBe('idle')
    })

    it('SecurityError also maps to VoicePermissionDeniedError', async () => {
      installMediaDevices(() => Promise.reject(makeDomException('SecurityError', 'sandboxed')))
      installMediaRecorder()
      const recorder = createRecorder()
      await expect(recorder.start()).rejects.toBeInstanceOf(VoicePermissionDeniedError)
    })

    it('NotFoundError → VoiceNoDeviceError', async () => {
      installMediaDevices(() => Promise.reject(makeDomException('NotFoundError', 'no mic')))
      installMediaRecorder()
      const recorder = createRecorder()
      await expect(recorder.start()).rejects.toBeInstanceOf(VoiceNoDeviceError)
    })

    it('OverconstrainedError also maps to VoiceNoDeviceError', async () => {
      installMediaDevices(() =>
        Promise.reject(makeDomException('OverconstrainedError', 'no match')),
      )
      installMediaRecorder()
      const recorder = createRecorder()
      await expect(recorder.start()).rejects.toBeInstanceOf(VoiceNoDeviceError)
    })

    it('unknown DOMException name falls back to VoicePluginError with cause preserved', async () => {
      const original = makeDomException('AbortError', 'aborted')
      installMediaDevices(() => Promise.reject(original))
      installMediaRecorder()
      const recorder = createRecorder()
      await expect(recorder.start()).rejects.toMatchObject({
        name: 'VoicePluginError',
        cause: original,
      })
    })

    it('MediaRecorder runtime error propagates via stop() rejection', async () => {
      installMediaDevices(() => Promise.resolve(makeFakeStream()))
      const mr = installMediaRecorder()
      const recorder = createRecorder()
      await recorder.start()
      const stopPromise = recorder.stop()
      mr.__lastInstance?.emitError(makeDomException('NotReadableError', 'busy'))
      await expect(stopPromise).rejects.toBeInstanceOf(VoicePluginError)
    })
  })

  describe('EC-12 — concurrent start dedup', () => {
    it('two parallel start() calls share the same in-flight Promise (no double MediaRecorder)', async () => {
      let resolveGetUserMedia: ((stream: unknown) => void) | undefined
      const getUserMedia = installMediaDevices(
        () =>
          new Promise((resolve) => {
            resolveGetUserMedia = resolve
          }),
      )
      installMediaRecorder()
      const recorder = createRecorder()

      const p1 = recorder.start()
      const p2 = recorder.start()
      // Before the first promise resolves, the second should be the SAME promise.
      expect(p1).toBe(p2)
      resolveGetUserMedia?.(makeFakeStream())
      await Promise.all([p1, p2])
      // getUserMedia must have been called exactly once.
      expect(getUserMedia).toHaveBeenCalledOnce()
    })

    it('calling start() while already recording is a no-op', async () => {
      const getUserMedia = installMediaDevices(() => Promise.resolve(makeFakeStream()))
      installMediaRecorder()
      const recorder = createRecorder()
      await recorder.start()
      // Second call after success — still no second getUserMedia.
      await recorder.start()
      expect(getUserMedia).toHaveBeenCalledOnce()
    })
  })

  describe('EC-15 — secure context guard', () => {
    it('throws VoicePluginConfigError when navigator.mediaDevices is absent', async () => {
      Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: undefined,
      })
      installMediaRecorder()
      const recorder = createRecorder()
      await expect(recorder.start()).rejects.toBeInstanceOf(VoicePluginConfigError)
    })

    it('throws VoicePluginConfigError when MediaRecorder is missing', async () => {
      installMediaDevices(() => Promise.resolve(makeFakeStream()))
      delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
      const recorder = createRecorder()
      await expect(recorder.start()).rejects.toBeInstanceOf(VoicePluginConfigError)
    })
  })

  describe('T5.2 — #213 in-recording error releases stream + surfaces', () => {
    it('test_recording_error_releases_stream_and_surfaces', async () => {
      // A MediaRecorder error DURING recording (no stop() pending) must always
      // release the stream AND surface via onError — not be silently dropped
      // with a leaked stream.
      const fakeStream = makeFakeStream()
      installMediaDevices(() => Promise.resolve(fakeStream))
      const mr = installMediaRecorder()
      const onError = vi.fn()
      const recorder = createRecorder({ onError })
      await recorder.start()
      expect(recorder.state()).toBe('recording')

      mr.__lastInstance?.emitError(makeDomException('NotReadableError', 'device lost'))

      expect(onError).toHaveBeenCalledOnce()
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(VoicePluginError)
      for (const t of fakeStream.getTracks()) {
        expect(t.stop).toHaveBeenCalledOnce()
      }
    })
  })

  describe('state machine guards', () => {
    it('stop() called before start() rejects without crashing', async () => {
      installMediaDevices(() => Promise.resolve(makeFakeStream()))
      installMediaRecorder()
      const recorder = createRecorder()
      await expect(recorder.stop()).rejects.toBeInstanceOf(VoicePluginError)
    })
  })
})
