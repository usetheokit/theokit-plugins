/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- page.evaluate bodies run in the browser, where WakeWord is a bundle global */
/**
 * End-to-end: the wake-word helper in headless Chromium, with recorded speech as the microphone
 * (`--use-file-for-fake-audio-capture`). Fixtures in tests/fixtures/wake-word are real speech
 * synthesized by eSpeak (via meSpeak), not tones.
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { chromium as playwright, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, 'fixtures/wake-word')

const bundle = buildSync({
  entryPoints: [resolve(here, '../src/wake-word.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'WakeWord',
  write: false,
}).outputFiles[0]!.text

const html = `<!doctype html><meta charset="utf-8"><script>${bundle}</script>`

let server: Server
let origin = ''
const sttRequests: string[] = []

function serve(): Promise<void> {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/api/voice/stt') {
      sttRequests.push(`${req.method} ${url}`)
      req.resume()
      res.setHeader('content-type', 'application/json')
      res.end('{"text":""}')
    } else if (url.startsWith('/fixtures/')) {
      res.setHeader('content-type', 'audio/wav')
      res.end(readFileSync(join(fixtures, url.slice('/fixtures/'.length))))
    } else {
      res.setHeader('content-type', 'text/html')
      res.end(html)
    }
  })
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      origin = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`
      ok()
    }),
  )
}

async function launch(wav: string): Promise<{ page: Page; close: () => Promise<void> }> {
  // @sparticuz/chromium ships the shared libraries Chromium needs (nss etc.) and unpacks them only
  // when it believes it runs on a Lambda image; opt in so the test works on a bare CI runner.
  process.env.AWS_EXECUTION_ENV ??= 'AWS_Lambda_nodejs22.x'
  const { default: chromium } = await import('@sparticuz/chromium')
  const executablePath = await chromium.executablePath()
  process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}`
  const profileDir = mkdtempSync(join(tmpdir(), 'wake-e2e-'))
  const b = await playwright.launchPersistentContext(profileDir, {
    executablePath,
    headless: true,
    permissions: ['microphone'],
    args: [
      ...chromium.args.filter((a) => !a.startsWith('--single-process')),
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${join(fixtures, wav)}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const page = await b.newPage()
  return { page, close: () => b.close() }
}

/** Page-side: enroll from the three "theo" recordings, listen, and record a log of what happened. */
async function listen(page: Page): Promise<void> {
  await page.goto(origin)
  await page.evaluate(async () => {
    const w = (globalThis as any).WakeWord
    const ctx = new AudioContext()
    const clips = []
    for (const n of [1, 2, 3]) {
      const buf = await (await fetch(`/fixtures/theo-enroll-${n}.wav`)).arrayBuffer()
      const audio = await ctx.decodeAudioData(buf)
      clips.push({ samples: audio.getChannelData(0), sampleRate: audio.sampleRate })
    }
    const profile = w.enrollWakeWord('theo', clips)
    ;(globalThis as any).log = { wakes: 0, recordings: 0 }
    await w.startWakeWordListener({
      profile,
      onWake: () => {
        ;(globalThis as any).log.wakes++
      },
      onRecording: async (recorder: any) => {
        ;(globalThis as any).log.recordings++
        await new Promise((r) => setTimeout(r, 800))
        const blob = await recorder.stop()
        const body = new FormData()
        body.append('audio', blob, 'clip.webm')
        await fetch('/api/voice/stt', { method: 'POST', body })
      },
    })
  })
}

beforeAll(async () => {
  await serve()
}, 60_000)

afterAll(() => {
  server.close()
})

describe('wake word in headless Chromium', () => {
  it('fires on "theo", starts a recording, and sends STT only after the wake', async () => {
    sttRequests.length = 0
    const { page, close } = await launch('theo-wake.wav')
    try {
      await listen(page)
      await page.waitForFunction(() => (globalThis as any).log.recordings >= 1, null, {
        timeout: 30_000,
      })
      const log = await page.evaluate(() => (globalThis as any).log)
      expect(log.wakes).toBeGreaterThanOrEqual(1)
      await expect.poll(() => sttRequests.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    } finally {
      await close()
    }
  }, 90_000)

  it('fires nothing and sends no STT request for speech without the word', async () => {
    sttRequests.length = 0
    const { page, close } = await launch('no-wake.wav')
    try {
      await listen(page)
      // The fake microphone loops the file; let it play through more than twice (about 8 s each).
      await page.waitForTimeout(20_000)
      const log = await page.evaluate(() => (globalThis as any).log)
      expect(log).toEqual({ wakes: 0, recordings: 0 })
      expect(sttRequests).toEqual([])
    } finally {
      await close()
    }
  }, 90_000)
})
