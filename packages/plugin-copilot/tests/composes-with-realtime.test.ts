import { describe, expect, it } from 'vitest'

import { createMemoryRealtimeProvider } from '@theokit/plugin-realtime'

import type { CopilotRealtimeProvider } from '../src/types.js'

/**
 * This package declares `@theokit/plugin-realtime` as a PEER — it is telling a consumer that the
 * two are meant to be used together. Until this file existed, nothing checked that they can be.
 *
 * They could not. `CopilotFrame` is a structural mirror of `RealtimeFrame`, and the mirror stopped
 * at four variants while the original grew to six: `yjs-update` and `yjs-awareness` arrived with
 * Yjs support and were never copied across. A provider that can emit a frame the listener type
 * does not cover is not assignable to it — listeners are contravariant — so wiring the two in an
 * app failed at `tsc` with a message about `subscribeRoom`, several layers away from the cause.
 *
 * The mirror drifted unnoticed because the peer was never installed here: a peer nobody adds as a
 * devDependency is a compatibility claim nothing exercises. Adding it is half the fix, and the
 * half that stops this recurring.
 */
describe('the peer this package declares can actually be handed to it', () => {
  it('accepts a memory RealtimeProvider where a CopilotRealtimeProvider is required', () => {
    const provider = createMemoryRealtimeProvider()

    // The assignment IS the assertion: it is what fails to compile when the mirror drifts, and
    // `pnpm typecheck` covers this directory. The runtime check below only keeps the constant
    // from being elided as unused.
    const asCopilotProvider: CopilotRealtimeProvider = provider

    expect(typeof asCopilotProvider.subscribeRoom).toBe('function')
  })
})
