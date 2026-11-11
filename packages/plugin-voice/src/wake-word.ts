/**
 * On-device wake-word detection for @theokit/plugin-voice.
 *
 * A template-matching keyword spotter: the user enrolls a few utterances of the wake word, each is
 * reduced to MFCC frames, and the live microphone stream is compared against those templates with
 * subsequence dynamic time warping. Everything runs in the page — no audio is sent anywhere until
 * the detector fires and the caller decides to record.
 *
 * Why not a neural model: it needs no model download and no provider, and the word is whatever the
 * user enrolls. The trade-off is that it is speaker-dependent, so it must be enrolled by the person
 * who will use it.
 */

import { VoicePluginConfigError, VoicePluginError } from './errors.js'
import { createRecorder, type CreateRecorderOptions, type Recorder } from './recorder.js'

const SAMPLE_RATE = 16_000
const FRAME_LEN = 400 // 25 ms
const HOP = 160 // 10 ms
const FFT_SIZE = 512
const N_MEL = 26
const N_CEP = 12 // c1..c12, c0 (loudness) is dropped
const BUFFER_FRAMES = 300 // 3 s of context
const CHECK_EVERY_FRAMES = 5
const SPEECH_MARGIN_DB = 20 // a frame is speech when this far above the noise floor
const MIN_SPEECH_FRAMES = 12
const MAX_SPEECH_FRAMES = 150
const END_SILENCE_FRAMES = 8

/** MFCC frames of one enrolled utterance. */
export type WakeWordTemplate = number[][]

/** Result of enrollment; persist it (it is plain JSON) and pass it back to the detector. */
export interface WakeWordProfile {
  wakeWord: string
  templates: WakeWordTemplate[]
  /** Maximum DTW distance (per path step) still accepted as the wake word. */
  threshold: number
}

/** A mono clip of audio samples in [-1, 1]. */
export interface AudioClip {
  samples: Float32Array
  sampleRate: number
}

// ---------------------------------------------------------------------------
// Signal processing
// ---------------------------------------------------------------------------

function resample(clip: AudioClip): Float32Array {
  if (clip.sampleRate === SAMPLE_RATE) return clip.samples
  const ratio = clip.sampleRate / SAMPLE_RATE
  const outLen = Math.floor(clip.samples.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const a = clip.samples[i0] ?? 0
    const b = clip.samples[i0 + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

const HAMMING = Float64Array.from(
  { length: FRAME_LEN },
  (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1)),
)

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1)
}

const MEL_BANK: Float64Array[] = (() => {
  const bins = FFT_SIZE / 2 + 1
  const lo = hzToMel(100)
  const hi = hzToMel(SAMPLE_RATE / 2 - 200)
  const pts = Array.from({ length: N_MEL + 2 }, (_, i) =>
    Math.floor(((FFT_SIZE + 1) * melToHz(lo + ((hi - lo) * i) / (N_MEL + 1))) / SAMPLE_RATE),
  )
  return Array.from({ length: N_MEL }, (_, m) => {
    const f = new Float64Array(bins)
    const [l, c, r] = [pts[m]!, pts[m + 1]!, pts[m + 2]!]
    for (let k = l; k < c; k++) f[k] = (k - l) / Math.max(1, c - l)
    for (let k = c; k < r; k++) f[k] = (r - k) / Math.max(1, r - c)
    return f
  })
})()

const DCT: Float64Array[] = Array.from({ length: N_CEP }, (_, c) =>
  Float64Array.from({ length: N_MEL }, (_, m) => Math.cos((Math.PI * (c + 1) * (m + 0.5)) / N_MEL)),
)

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const a = i + k
        const b = a + len / 2
        const tr = re[b]! * wr - im[b]! * wi
        const ti = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
      }
    }
  }
}

interface Frame {
  /** Log energy in dB. */
  energy: number
  mfcc: number[]
}

function analyzeFrame(x: Float32Array, start: number): Frame {
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  let sum = 0
  let prev = 0
  for (let i = 0; i < FRAME_LEN; i++) {
    const s = x[start + i] ?? 0
    const v = s - 0.97 * prev // pre-emphasis
    prev = s
    re[i] = v * HAMMING[i]!
    sum += s * s
  }
  fft(re, im)
  const logMel = MEL_BANK.map((f) => {
    let e = 0
    for (let k = 0; k < f.length; k++) e += f[k]! * (re[k]! * re[k]! + im[k]! * im[k]!)
    return Math.log(e + 1e-8)
  })
  const mfcc = DCT.map((row) => {
    let v = 0
    for (let m = 0; m < N_MEL; m++) v += row[m]! * logMel[m]!
    return v
  })
  return { energy: 10 * Math.log10(sum / FRAME_LEN + 1e-10), mfcc }
}

function analyze(samples: Float32Array): Frame[] {
  const frames: Frame[] = []
  for (let s = 0; s + FRAME_LEN <= samples.length; s += HOP) frames.push(analyzeFrame(samples, s))
  return frames
}

/** Cut the longest-energy run of speech out of a clip, using a noise floor from its quietest frames. */
function extractSpeech(frames: Frame[]): Frame[] {
  if (frames.length === 0) return []
  const sorted = frames.map((f) => f.energy).sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)]!
  const peak = sorted[sorted.length - 1]!
  const gate = Math.max(floor + SPEECH_MARGIN_DB, peak - 35)
  let best: [number, number] = [0, 0]
  let runStart = -1
  let quiet = 0
  for (let i = 0; i <= frames.length; i++) {
    const loud = i < frames.length && frames[i]!.energy > gate
    if (loud) {
      if (runStart < 0) runStart = i
      quiet = 0
    } else if (runStart >= 0) {
      quiet++
      if (quiet >= END_SILENCE_FRAMES || i === frames.length) {
        const end = i - quiet + 1
        if (end - runStart > best[1] - best[0]) best = [runStart, end]
        runStart = -1
        quiet = 0
      }
    }
  }
  return frames.slice(best[0], best[1])
}

function distance(a: number[], b: number[]): number {
  let d = 0
  for (let i = 0; i < a.length; i++) d += (a[i]! - b[i]!) ** 2
  return Math.sqrt(d)
}

/** Subtract the mean of each coefficient (cepstral mean normalization) over the given frames. */
function normalize(frames: number[][]): number[][] {
  const mean = new Array<number>(N_CEP).fill(0)
  for (const f of frames) for (let i = 0; i < N_CEP; i++) mean[i]! += f[i]!
  for (let i = 0; i < N_CEP; i++) mean[i]! /= Math.max(1, frames.length)
  return frames.map((f) => f.map((v, i) => v - mean[i]!))
}

/** Whole-sequence DTW distance per path step, between two templates. */
function dtw(a: number[][], b: number[][]): number {
  const n = a.length
  const m = b.length
  let prev = new Float64Array(m + 1).fill(Infinity)
  let prevLen = new Float64Array(m + 1)
  prev[0] = 0
  for (let i = 1; i <= n; i++) {
    const cur = new Float64Array(m + 1).fill(Infinity)
    const curLen = new Float64Array(m + 1)
    for (let j = 1; j <= m; j++) {
      const d = distance(a[i - 1]!, b[j - 1]!)
      let best = prev[j - 1]!
      let len = prevLen[j - 1]!
      if (prev[j]! < best) [best, len] = [prev[j]!, prevLen[j]!]
      if (cur[j - 1]! < best) [best, len] = [cur[j - 1]!, curLen[j - 1]!]
      cur[j] = best + d
      curLen[j] = len + 1
    }
    prev = cur
    prevLen = curLen
  }
  return prev[m]! / Math.max(1, prevLen[m]!)
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/** How far above the worst enrollment-to-enrollment distance a live match may sit. */
const THRESHOLD_MARGIN = 1.35
/** Lower bound so identical enrollments do not produce an unreachable threshold. */
const MIN_THRESHOLD = 3

function speechTemplate(clip: AudioClip): WakeWordTemplate {
  const speech = extractSpeech(analyze(resample(clip))).map((f) => f.mfcc)
  if (speech.length < MIN_SPEECH_FRAMES) {
    throw new VoicePluginError(
      'Wake-word enrollment clip contains no usable speech. Say the word clearly, close to the microphone.',
    )
  }
  if (speech.length > MAX_SPEECH_FRAMES) {
    throw new VoicePluginError(
      'Wake-word enrollment clip is too long. Enroll the word alone, about one second each.',
    )
  }
  return normalize(speech)
}

/**
 * Build a profile from several recorded utterances of the wake word (three or more recommended).
 * The acceptance threshold is derived from how much the utterances differ from one another.
 */
export function enrollWakeWord(wakeWord: string, clips: AudioClip[]): WakeWordProfile {
  if (wakeWord.trim() === '') {
    throw new VoicePluginConfigError('@theokit/plugin-voice: wakeWord must be a non-empty string.')
  }
  if (clips.length < 2) {
    throw new VoicePluginConfigError(
      '@theokit/plugin-voice: wake-word enrollment needs at least 2 utterances (3 recommended).',
    )
  }
  const templates = clips.map(speechTemplate)
  let worst = 0
  for (let i = 0; i < templates.length; i++) {
    for (let j = i + 1; j < templates.length; j++) {
      worst = Math.max(worst, dtw(templates[i]!, templates[j]!))
    }
  }
  return { wakeWord, templates, threshold: Math.max(MIN_THRESHOLD, worst * THRESHOLD_MARGIN) }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface WakeWordDetectorOptions {
  profile: WakeWordProfile
  /** Called when the wake word is heard. */
  onWake: (event: WakeWordEvent) => void
  /** Ignore further matches for this long after a fire. Defaults to 2000 ms. */
  cooldownMs?: number
}

export interface WakeWordEvent {
  wakeWord: string
  /** DTW distance of the match; lower is closer. */
  score: number
}

export interface WakeWordDetector {
  /** Feed a chunk of mono microphone audio. Cheap to call on every audio callback. */
  feed(samples: Float32Array, sampleRate: number): void
  reset(): void
}

/**
 * Create a streaming detector. The audio fed in is only analyzed locally; nothing leaves the page.
 */
export function createWakeWordDetector(opts: WakeWordDetectorOptions): WakeWordDetector {
  const { profile, onWake } = opts
  const cooldownFrames = Math.round((opts.cooldownMs ?? 2000) / 10)
  if (profile.templates.length === 0) {
    throw new VoicePluginConfigError('@theokit/plugin-voice: wake-word profile has no templates.')
  }

  let pending = new Float32Array(0)
  let frames: Frame[] = []
  let sinceCheck = 0
  let cooldown = 0

  function check(): void {
    const speech = extractSpeech(frames)
    if (speech.length < MIN_SPEECH_FRAMES || speech.length > MAX_SPEECH_FRAMES) return
    // Only judge once the speech has ended, so a word is matched whole and not by its first half.
    const lastLoud = frames.indexOf(speech[speech.length - 1]!)
    if (frames.length - 1 - lastLoud < END_SILENCE_FRAMES) return
    const probe = normalize(speech.map((f) => f.mfcc))
    let score = Infinity
    for (const t of profile.templates) score = Math.min(score, dtw(probe, t))
    if (score <= profile.threshold) {
      cooldown = cooldownFrames
      frames = []
      onWake({ wakeWord: profile.wakeWord, score })
    }
  }

  return {
    feed(samples, sampleRate) {
      const chunk = resample({ samples, sampleRate })
      const merged = new Float32Array(pending.length + chunk.length)
      merged.set(pending)
      merged.set(chunk, pending.length)
      let off = 0
      while (off + FRAME_LEN <= merged.length) {
        frames.push(analyzeFrame(merged, off))
        if (frames.length > BUFFER_FRAMES) frames.shift()
        off += HOP
        if (cooldown > 0) {
          cooldown--
          frames = []
          continue
        }
        if (++sinceCheck >= CHECK_EVERY_FRAMES) {
          sinceCheck = 0
          check()
        }
      }
      pending = merged.slice(off)
    },
    reset() {
      pending = new Float32Array(0)
      frames = []
      sinceCheck = 0
      cooldown = 0
    },
  }
}

// ---------------------------------------------------------------------------
// Browser helper
// ---------------------------------------------------------------------------

export interface WakeWordListenerOptions {
  profile: WakeWordProfile
  /** Fired when the wake word is heard, before the recording starts. */
  onWake?: (event: WakeWordEvent) => void
  /**
   * Called once the recorder is running after a wake. Stop it with `recorder.stop()` and send the
   * blob to `/api/voice/stt` — this is the first point at which any audio leaves the device.
   */
  onRecording?: (recorder: Recorder) => void
  onError?: (err: VoicePluginError) => void
  recorder?: CreateRecorderOptions
  cooldownMs?: number
}

export interface WakeWordListener {
  /** Whether the microphone is currently being listened to. */
  listening(): boolean
  /** Stop listening and release the microphone. Idempotent. */
  stop(): void
}

/**
 * Listen to the microphone for the wake word and start a recording when it is heard.
 *
 * Audio is analyzed in-page by {@link createWakeWordDetector}; no request is made until the caller
 * stops the recording handed to `onRecording`.
 */
export async function startWakeWordListener(
  opts: WakeWordListenerOptions,
): Promise<WakeWordListener> {
  const g = globalThis as {
    navigator?: Navigator
    AudioContext?: typeof AudioContext
  }
  const md = g.navigator?.mediaDevices
  if (md === undefined || typeof md.getUserMedia !== 'function' || g.AudioContext === undefined) {
    throw new VoicePluginConfigError(
      '@theokit/plugin-voice: wake-word listening needs getUserMedia and Web Audio in a secure context (HTTPS or localhost).',
    )
  }
  let stream: MediaStream
  try {
    stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? ''
    throw new VoicePluginError(`Microphone unavailable for wake-word listening (${name}).`, {
      cause: err,
    })
  }
  const ctx = new g.AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated but works everywhere without a separately served worklet file.
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const sink = ctx.createGain()
  sink.gain.value = 0
  let active = true
  let recorder: Recorder | null = null

  const detector = createWakeWordDetector({
    profile: opts.profile,
    cooldownMs: opts.cooldownMs,
    onWake(event) {
      opts.onWake?.(event)
      if (recorder !== null && recorder.state() === 'recording') return
      const r = createRecorder({ ...opts.recorder, onError: opts.onError })
      recorder = r
      r.start().then(
        () => opts.onRecording?.(r),
        (err: unknown) =>
          opts.onError?.(err instanceof VoicePluginError ? err : new VoicePluginError(String(err))),
      )
    },
  })

  node.onaudioprocess = (e) => {
    if (active) detector.feed(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate)
  }
  source.connect(node)
  node.connect(sink)
  sink.connect(ctx.destination)

  return {
    listening: () => active,
    stop() {
      if (!active) return
      active = false
      node.onaudioprocess = null
      source.disconnect()
      node.disconnect()
      for (const t of stream.getTracks()) t.stop()
      void ctx.close()
    },
  }
}
