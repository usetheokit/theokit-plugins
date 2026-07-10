import { describe, expect, it } from 'vitest'
import { ensureCanvasPeer } from '../src/internal/canvas-bridge.js'
import { ensureVoicePeer } from '../src/internal/voice-bridge.js'
import { CopilotConfigError } from '../src/types.js'

describe('voice-bridge', () => {
  it('returns disabled when config undefined', async () => {
    expect(await ensureVoicePeer(undefined)).toEqual({ enabled: false })
  })

  it('returns disabled when neither transcribeWith nor speakWith set', async () => {
    expect(await ensureVoicePeer({})).toEqual({ enabled: false })
  })

  it('throws CopilotConfigError when peer absent + voice configured', async () => {
    await expect(ensureVoicePeer({ transcribeWith: 'plugin-voice' })).rejects.toThrow(
      CopilotConfigError,
    )
  })
})

describe('canvas-bridge', () => {
  it('returns disabled when config undefined', async () => {
    expect(await ensureCanvasPeer(undefined)).toEqual({ enabled: false })
  })

  it('returns disabled when emitArtifacts false', async () => {
    expect(await ensureCanvasPeer({ emitArtifacts: false })).toEqual({ enabled: false })
  })

  it('throws CopilotConfigError when peer absent + canvas configured', async () => {
    await expect(ensureCanvasPeer({ emitArtifacts: true })).rejects.toThrow(CopilotConfigError)
  })
})
