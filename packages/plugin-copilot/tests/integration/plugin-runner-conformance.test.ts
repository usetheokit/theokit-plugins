/**
 * The plugin, handed to the framework's own runner.
 *
 * #42 is the reason this file exists rather than a test against a hand-written `TheoApp`.
 * A mock app is written by the same person as the plugin, so it grows whatever methods
 * the plugin happens to call — that is how this repository ended up with a suite that
 * "wired CLI + devtools-tab end-to-end" against `registerCliCommand` and
 * `registerDevtoolsTab`, neither of which the real `TheoApp` has ever had. The test
 * confirmed the fabrication instead of catching it.
 *
 * So the assertion here is: `createPluginRunnerFromConfig`, the function `theo.config.ts`
 * feeds, accepts what `copilot()` returns. If the plugin shape drifts from what the
 * runner takes, this fails — with no network, no key and no app to boot.
 */

import { createPluginRunnerFromConfig } from 'theokit/server/plugins'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineCopilot } from '../../src/define-copilot.js'
import { copilot, COPILOT_DECORATION_KEY, type CopilotRequestSurface } from '../../src/plugin.js'
import type { CopilotAgentLike, CopilotFrame, CopilotRealtimeProvider } from '../../src/types.js'

/** The narrowest provider the runtime accepts; no room traffic happens in these tests. */
function silentProvider(): CopilotRealtimeProvider {
  const subs = new Map<string, Set<(frame: CopilotFrame) => void>>()
  return {
    joinRoom: () => Promise.resolve(),
    leaveRoom: () => Promise.resolve(),
    updatePresence: () => Promise.resolve(),
    broadcast: () => Promise.resolve(),
    getPresence: () => Promise.resolve({}),
    subscribeRoom(roomId, cb) {
      const set = subs.get(roomId) ?? new Set()
      set.add(cb)
      subs.set(roomId, set)
      return () => set.delete(cb)
    },
  }
}

/**
 * A hook would run on EVERY request in the host app, including the ones that never speak
 * to an agent. Failing here rather than counting calls means a future `addHook` shows up
 * as a red test naming the reason, not as a number nobody reads.
 */
function refuseHook(): never {
  throw new Error('the copilot plugin must not register a hook — it would run on every request')
}

const idleAgent: CopilotAgentLike = {
  // eslint-disable-next-line @typescript-eslint/require-await -- generator shape, no awaits needed
  async *streamObject<T>() {
    yield { type: 'complete' as const, object: { text: '' } as unknown as T }
  },
}

function helper() {
  return defineCopilot({
    id: 'helper',
    room: {
      id: 'canvas',
      presence: z.object({ typing: z.boolean().optional() }),
      broadcast: z.object({ kind: z.string(), text: z.string() }),
    },
    agent: { name: 'Helper', model: 'openrouter/openai/gpt-4o-mini' },
    identity: { name: 'Helper' },
    triggers: [{ on: 'broadcast:question', action: 'respond' }],
    budget: { perRoom: { dailyUsd: 1 } },
  })
}

describe("theokit's own plugin runner accepts this plugin", () => {
  it('is built without complaint by createPluginRunnerFromConfig', async () => {
    const plugin = copilot({ provider: silentProvider(), agent: idleAgent, copilots: [helper()] })

    // The function `theo.config.ts` feeds. It validates the shape and throws
    // `InvalidPluginShapeError` on anything it cannot run.
    const runner = await createPluginRunnerFromConfig([plugin])

    expect(runner, 'the runner refused the plugin').toBeDefined()
  })

  it('publishes its surface on the decoration key it documents', () => {
    const plugin = copilot({ provider: silentProvider(), agent: idleAgent, copilots: [helper()] })

    // Play the runner's own role for the one call it makes on register: capture the
    // decoration rather than asserting a method exists on a mock app.
    const decorations = new Map<string, unknown>()
    plugin.register({
      addHook: refuseHook,
      decorateRequest: (key, value) => decorations.set(key, value),
    })

    expect([...decorations.keys()]).toEqual([COPILOT_DECORATION_KEY])
    const surface = decorations.get(COPILOT_DECORATION_KEY) as CopilotRequestSurface
    expect(surface.ids).toEqual(['helper'])
  })

  it('the surface reads real runtime state, not a snapshot taken at register time', () => {
    const plugin = copilot({ provider: silentProvider(), agent: idleAgent, copilots: [helper()] })
    const decorations = new Map<string, unknown>()
    plugin.register({ addHook: refuseHook, decorateRequest: (k, v) => decorations.set(k, v) })
    const surface = decorations.get(COPILOT_DECORATION_KEY) as CopilotRequestSurface

    // Registering after the decoration must be visible through it — `ids` is a getter for
    // this reason. A copied array here would go stale the first time a copilot is added.
    plugin.runtime.registerCopilot(
      defineCopilot({
        ...helper(),
        id: 'second',
      }),
    )

    expect(surface.ids).toContain('second')
    expect(surface.get('second')?.identity.name).toBe('Helper')
    expect(surface.usage('helper')).toEqual({
      dailyUsedUsd: 0,
      monthlyUsedUsd: 0,
      inFlightUsd: 0,
    })
  })

  it('an unknown id reads as absent rather than throwing', () => {
    const plugin = copilot({ provider: silentProvider(), agent: idleAgent, copilots: [helper()] })
    const decorations = new Map<string, unknown>()
    plugin.register({ addHook: refuseHook, decorateRequest: (k, v) => decorations.set(k, v) })
    const surface = decorations.get(COPILOT_DECORATION_KEY) as CopilotRequestSurface

    // A usage panel rendering a stale id should show a gap, not fail the request.
    expect(surface.usage('gone')).toBeUndefined()
    expect(surface.get('gone')).toBeUndefined()
  })
})
