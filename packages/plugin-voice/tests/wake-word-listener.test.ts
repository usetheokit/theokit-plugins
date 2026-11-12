import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoicePluginConfigError, VoicePluginError } from '../src/errors.js'
import type { Recorder, RecorderState } from '../src/recorder.js'
import { enrollWakeWord, startWakeWordListener, type AudioClip } from '../src/wake-word.js'

const recorders: { rec: Recorder; startResult: () => Promise<void>; st: RecorderState }[] = []
let nextStart: () => Promise<void> = () => Promise.resolve()

vi.mock('../src/recorder.js', () => ({
  createRecorder: () => {
    const entry = {
      st: 'idle' as RecorderState,
      startResult: nextStart,
      rec: undefined as unknown as Recorder,
    }
    entry.rec = {
      start: () => {
        entry.st = 'recording'
        return entry.startResult()
      },
      stop: () => Promise.resolve(new Blob([])),
      state: () => entry.st,
      release: () => undefined,
    }
    recorders.push(entry)
    return entry.rec
  },
}))

const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/wake-word')
function wav(name: string): AudioClip {
  const b = readFileSync(resolve(dir, `${name}.wav`))
  const pcm = new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length))
  return { samples: Float32Array.from(pcm, (v) => v / 32768), sampleRate: 22050 }
}
const profile = () =>
  enrollWakeWord(
    'theo',
    [1, 2, 3].map((i) => wav(`theo-enroll-${i}`)),
  )

interface FakeNode {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}
let node: FakeNode
let trackStop: ReturnType<typeof vi.fn>
let ctxClose: ReturnType<typeof vi.fn>
let sourceDisconnect: ReturnType<typeof vi.fn>

function installAudio(): void {
  trackStop = vi.fn()
  ctxClose = vi.fn(() => Promise.resolve())
  sourceDisconnect = vi.fn()
  node = { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() }
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: trackStop }] })),
    },
  })
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 22050
      destination = {}
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: sourceDisconnect }
      }
      createScriptProcessor() {
        return node
      }
      createGain() {
        return { gain: { value: 1 }, connect: vi.fn() }
      }
      close = ctxClose
    },
  )
}

/** Push the whole clip through the audio callback, as the browser would. */
function play(name: string): void {
  const clip = wav(name)
  for (let o = 0; o < clip.samples.length; o += 4096) {
    const chunk = clip.samples.slice(o, o + 4096)
    node.onaudioprocess?.({ inputBuffer: { getChannelData: () => chunk } })
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  recorders.length = 0
  nextStart = () => Promise.resolve()
  installAudio()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startWakeWordListener', () => {
  it('rejects when getUserMedia or Web Audio is missing', async () => {
    vi.stubGlobal('navigator', {})
    await expect(startWakeWordListener({ profile: profile() })).rejects.toBeInstanceOf(
      VoicePluginConfigError,
    )
    installAudio()
    vi.stubGlobal('AudioContext', undefined)
    await expect(startWakeWordListener({ profile: profile() })).rejects.toThrow(/getUserMedia/)
  })

  it('wraps a microphone failure with the error name', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
      },
    })
    await expect(startWakeWordListener({ profile: profile() })).rejects.toThrow(/NotAllowedError/)
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: () => Promise.reject(new Error('x')) },
    })
    await expect(startWakeWordListener({ profile: profile() })).rejects.toBeInstanceOf(
      VoicePluginError,
    )
  })

  it('starts a recording on the wake word, once, and reports it', async () => {
    const onWake = vi.fn()
    const onRecording = vi.fn()
    const l = await startWakeWordListener({ profile: profile(), onWake, onRecording })
    expect(l.listening()).toBe(true)
    play('theo-wake')
    await flush()
    expect(onWake).toHaveBeenCalledTimes(1)
    expect(recorders).toHaveLength(1)
    expect(onRecording).toHaveBeenCalledWith(recorders[0]!.rec)
    l.stop()
  })

  it('does not start a second recorder while one is recording', async () => {
    const l = await startWakeWordListener({ profile: profile(), cooldownMs: 0 })
    play('theo-wake')
    play('theo-wake')
    await flush()
    expect(recorders).toHaveLength(1)
    l.stop()
  })

  it('does not fire on speech without the word', async () => {
    const onWake = vi.fn()
    const l = await startWakeWordListener({ profile: profile(), onWake })
    play('no-wake')
    expect(onWake).not.toHaveBeenCalled()
    l.stop()
  })

  it('reports a recorder start failure through onError', async () => {
    const onError = vi.fn()
    nextStart = () => Promise.reject(new VoicePluginError('denied'))
    const l = await startWakeWordListener({ profile: profile(), onError })
    play('theo-wake')
    await flush()
    expect(onError).toHaveBeenCalledWith(expect.any(VoicePluginError))
    l.stop()

    onError.mockClear()
    nextStart = () => Promise.reject(new Error('boom'))
    const l2 = await startWakeWordListener({ profile: profile(), onError })
    play('theo-wake')
    await flush()
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(VoicePluginError)
    expect((onError.mock.calls[0]![0] as Error).message).toContain('boom')
    l2.stop()
  })

  it('stop releases the microphone, is idempotent, and ignores later audio', async () => {
    const onWake = vi.fn()
    const l = await startWakeWordListener({ profile: profile(), onWake })
    l.stop()
    l.stop()
    expect(l.listening()).toBe(false)
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(ctxClose).toHaveBeenCalledTimes(1)
    expect(sourceDisconnect).toHaveBeenCalledTimes(1)
    expect(node.disconnect).toHaveBeenCalledTimes(1)
    expect(node.onaudioprocess).toBeNull()
  })

  it('ignores audio delivered after stop', async () => {
    const onWake = vi.fn()
    const l = await startWakeWordListener({ profile: profile(), onWake })
    const handler = node.onaudioprocess!
    l.stop()
    const chunk = new Float32Array(4096)
    handler({ inputBuffer: { getChannelData: () => chunk } })
    expect(onWake).not.toHaveBeenCalled()
  })
})
