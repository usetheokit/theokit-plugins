import { describe, expect, it } from 'vitest'
import { TriggerEvaluator } from '../src/internal/trigger-evaluator.js'
import type { CopilotFrame, CopilotTrigger } from '../src/types.js'

describe('TriggerEvaluator', () => {
  it('matches broadcast:<event> trigger to corresponding frame', () => {
    const evalr = new TriggerEvaluator()
    const trigger: CopilotTrigger = { on: 'broadcast:question', action: 'respond' }
    const frame: CopilotFrame = {
      type: 'broadcast',
      connectionId: 'user-1',
      event: 'question',
      payload: { text: '?' },
    }
    const matches = evalr.evaluate([trigger], frame, 'room-1')
    expect(matches).toHaveLength(1)
  })

  it('does NOT match different broadcast event', () => {
    const evalr = new TriggerEvaluator()
    const trigger: CopilotTrigger = { on: 'broadcast:question', action: 'respond' }
    const frame: CopilotFrame = {
      type: 'broadcast',
      connectionId: 'user-1',
      event: 'ping',
      payload: {},
    }
    expect(evalr.evaluate([trigger], frame, 'room')).toHaveLength(0)
  })

  it('filters out copilot-originated frames (EC-4 / EC-8 guard)', () => {
    const evalr = new TriggerEvaluator()
    const trigger: CopilotTrigger = { on: 'broadcast:question', action: 'respond' }
    const frame: CopilotFrame = {
      type: 'broadcast',
      connectionId: 'copilot:other',
      event: 'question',
      payload: { text: 'loop?' },
    }
    expect(evalr.evaluate([trigger], frame, 'room')).toHaveLength(0)
  })

  it('custom trigger calls filter function', () => {
    const evalr = new TriggerEvaluator()
    const trigger: CopilotTrigger = {
      on: 'custom',
      filter: (f) => f.type === 'presence-changed',
      action: 'suggest',
    }
    const frame: CopilotFrame = {
      type: 'presence-changed',
      connectionId: 'user-1',
      presence: { cursor: [1, 2] },
    }
    expect(evalr.evaluate([trigger], frame, 'room')).toHaveLength(1)
  })

  it('presence:idle trigger is NEVER matched by frames (handled via scheduleIdleCheck)', () => {
    const evalr = new TriggerEvaluator()
    const trigger: CopilotTrigger = { on: 'presence:idle', action: 'suggest', idleMs: 1000 }
    const frame: CopilotFrame = {
      type: 'presence-changed',
      connectionId: 'user-1',
      presence: {},
    }
    expect(evalr.evaluate([trigger], frame, 'room')).toHaveLength(0)
  })

  it('scheduleIdleCheck fires onIdle when no activity within idleMs', async () => {
    const evalr = new TriggerEvaluator()
    let fired = false
    const trigger = { on: 'presence:idle' as const, action: 'suggest' as const, idleMs: 50 }
    const stop = evalr.scheduleIdleCheck('room', trigger, () => {
      fired = true
    })
    // Track an early frame
    evalr.evaluate([], { type: 'joined', connectionId: 'user-1', presence: {} }, 'room')
    // Wait > idleMs * 2 to give scheduler 2 ticks
    await new Promise((r) => setTimeout(r, 200))
    stop()
    expect(fired).toBe(true)
    evalr.clearRoom('room')
  })

  it('clearRoom removes tracking + timers', () => {
    const evalr = new TriggerEvaluator()
    const stop = evalr.scheduleIdleCheck(
      'room',
      { on: 'presence:idle', action: 'suggest', idleMs: 1000 },
      () => {
        /* intentionally empty — onIdle not expected to fire in this test */
      },
    )
    evalr.clearRoom('room')
    // Calling stop after clearRoom should not throw
    expect(() => stop()).not.toThrow()
  })
})
