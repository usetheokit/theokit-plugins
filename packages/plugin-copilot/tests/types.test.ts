import { describe, expect, it } from 'vitest'
import { CopilotConfigError, CopilotError, CopilotTriggerError } from '../src/types.js'

describe('CopilotError hierarchy', () => {
  it('CopilotError carries optional code', () => {
    const e = new CopilotError('boom', { code: 'test_code' })
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('CopilotError')
    expect(e.code).toBe('test_code')
  })

  it("CopilotConfigError defaults code 'copilot_config_invalid'", () => {
    const e = new CopilotConfigError('bad config')
    expect(e).toBeInstanceOf(CopilotError)
    expect(e.name).toBe('CopilotConfigError')
    expect(e.code).toBe('copilot_config_invalid')
  })

  it("CopilotTriggerError defaults code 'copilot_trigger_failed'", () => {
    const e = new CopilotTriggerError('bad trigger')
    expect(e.name).toBe('CopilotTriggerError')
    expect(e.code).toBe('copilot_trigger_failed')
  })

  it('CopilotConfigError accepts custom code', () => {
    const e = new CopilotConfigError('voice missing', { code: 'plugin-voice_missing' })
    expect(e.code).toBe('plugin-voice_missing')
  })

  it('CopilotError propagates cause', () => {
    const cause = new Error('upstream')
    const e = new CopilotError('wrap', { cause })
    expect(e.cause).toBe(cause)
  })
})
