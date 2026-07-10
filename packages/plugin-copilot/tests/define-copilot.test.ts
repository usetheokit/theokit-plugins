import { describe, expect, it } from 'vitest'
import { defineCopilot } from '../src/define-copilot.js'
import { CopilotConfigError } from '../src/types.js'

const passthroughSchema = {
  safeParse: (v: unknown) => ({ success: true as const, data: v }),
}

const baseInput = {
  id: 'test-copilot',
  room: { id: 'room-1', presence: passthroughSchema, broadcast: passthroughSchema },
  agent: { name: 'GPT', model: 'openrouter/openai/gpt-4o-mini' },
  identity: { name: 'AI' },
  triggers: [{ on: 'broadcast:question' as const, action: 'respond' as const }],
}

describe('defineCopilot', () => {
  it('returns descriptor for minimum valid input', () => {
    const d = defineCopilot(baseInput)
    expect(d.id).toBe('test-copilot')
    expect(d.room.id).toBe('room-1')
    expect(d.agent.name).toBe('GPT')
    expect(d.identity.name).toBe('AI')
    expect(d.triggers).toHaveLength(1)
  })

  it('preserves optional configs (rateLimit + budget + voice + canvas + dispatcher)', () => {
    const d = defineCopilot({
      ...baseInput,
      rateLimit: { tokens: 100, windowMs: 60_000 },
      budget: { perRoom: { dailyUsd: 5 } },
      voice: { transcribeWith: 'plugin-voice' },
      canvas: { emitArtifacts: true },
      dispatcher: 'round-robin',
    })
    expect(d.rateLimit?.tokens).toBe(100)
    expect(d.budget?.perRoom?.dailyUsd).toBe(5)
    expect(d.voice?.transcribeWith).toBe('plugin-voice')
    expect(d.canvas?.emitArtifacts).toBe(true)
    expect(d.dispatcher).toBe('round-robin')
  })

  it('rejects invalid id', () => {
    expect(() => defineCopilot({ ...baseInput, id: '' })).toThrow(CopilotConfigError)
    expect(() => defineCopilot({ ...baseInput, id: '1starts-with-number' })).toThrow(
      CopilotConfigError,
    )
    expect(() => defineCopilot({ ...baseInput, id: 'with spaces' })).toThrow(CopilotConfigError)
  })

  it('rejects missing room id', () => {
    expect(() =>
      defineCopilot({
        ...baseInput,
        room: { id: '', presence: passthroughSchema, broadcast: passthroughSchema },
      }),
    ).toThrow(CopilotConfigError)
  })

  it('rejects missing agent.name', () => {
    expect(() =>
      defineCopilot({
        ...baseInput,
        agent: { name: '', model: 'x' },
      }),
    ).toThrow(CopilotConfigError)
  })

  it('rejects missing agent.model', () => {
    expect(() =>
      defineCopilot({
        ...baseInput,
        // @ts-expect-error runtime guard
        agent: { name: 'GPT' },
      }),
    ).toThrow(CopilotConfigError)
  })

  it('rejects empty identity.name', () => {
    expect(() => defineCopilot({ ...baseInput, identity: { name: '' } })).toThrow(
      CopilotConfigError,
    )
  })

  it('rejects empty triggers', () => {
    expect(() => defineCopilot({ ...baseInput, triggers: [] })).toThrow(CopilotConfigError)
  })

  it('rejects custom trigger without filter fn', () => {
    expect(() =>
      defineCopilot({
        ...baseInput,
        triggers: [
          {
            on: 'custom',
            // @ts-expect-error runtime guard
            filter: undefined,
            action: 'respond',
          },
        ],
      }),
    ).toThrow(CopilotConfigError)
  })

  it('rejects presence:idle trigger without idleMs', () => {
    expect(() =>
      defineCopilot({
        ...baseInput,
        triggers: [
          {
            on: 'presence:idle',
            action: 'suggest',
            idleMs: 0,
          },
        ],
      }),
    ).toThrow(CopilotConfigError)
  })
})
