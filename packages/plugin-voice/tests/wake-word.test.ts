import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createWakeWordDetector, enrollWakeWord, type AudioClip } from '../src/wake-word.js'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/wake-word')

/** Read a 16-bit mono PCM WAV (44-byte header, 22.05 kHz) as a clip. */
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

function run(name: string): number {
  let fires = 0
  const d = createWakeWordDetector({ profile: profile(), onWake: () => fires++ })
  const clip = wav(name)
  for (let o = 0; o < clip.samples.length; o += 4096) {
    d.feed(clip.samples.subarray(o, o + 4096), clip.sampleRate)
  }
  return fires
}

describe('wake-word detector on recorded speech', () => {
  it('fires on the enrolled word', () => {
    expect(run('theo-wake')).toBe(1)
  })
  it('does not fire on a sentence without it', () => {
    expect(run('no-wake')).toBe(0)
  })
  it('does not fire on silence', () => {
    let fires = 0
    const d = createWakeWordDetector({ profile: profile(), onWake: () => fires++ })
    d.feed(new Float32Array(48_000), 16_000)
    expect(fires).toBe(0)
  })
  it('rejects enrollment without speech or with too few clips', () => {
    const silent = { samples: new Float32Array(16_000), sampleRate: 16_000 }
    expect(() => enrollWakeWord('theo', [silent, silent])).toThrow(/no usable speech/)
    expect(() => enrollWakeWord('theo', [wav('theo-enroll-1')])).toThrow(/at least 2/)
    expect(() => enrollWakeWord(' ', [])).toThrow(/non-empty/)
  })
})
