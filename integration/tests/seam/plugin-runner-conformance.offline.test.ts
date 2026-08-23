/**
 * Every plugin package, handed to the runner TheoKit actually uses.
 *
 * The gap this closes was measured, not assumed. A capability check added to
 * `plugin-payments` — `Object.keys(app).includes('decorateRequest')`, ordinary code a plugin
 * might write to probe the surface it got — passed `pnpm typecheck`, `pnpm test`, `pnpm lint`,
 * `pnpm build` and `pnpm integration:offline`, all five green, while
 * `createPluginRunnerFromConfig` threw `TypeError` on the same build.
 *
 * The reason is that the runner passes `Object.create(parentApp)`, whose methods are own but
 * NON-ENUMERABLE, while every unit test in this repo builds a plain object literal — see
 * `packages/plugin-payments/tests/plugin.test.ts:51`. `Object.keys()` returns `[]` for the real
 * scope and both method names for the fake. A fake agrees with whoever wrote it; this file does
 * not use one.
 *
 * Pinned to theokit 0.48.8. If a framework upgrade changes `isPlugin`, the failures below name
 * the seam rather than the package, so the reader is pointed at the framework first.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { payments } from '@theokit/plugin-payments'
import type { PaymentProvider } from '@theokit/plugin-payments'
import voicePlugin from '@theokit/plugin-voice'
import { InvalidPluginShapeError, createPluginRunnerFromConfig } from 'theokit/server/plugins'
import { describe, expect, it } from 'vitest'

/**
 * Minimal payments gateway — the plugin needs one provider to build at all.
 *
 * Typed as the real `PaymentProvider`, so the compiler rejects a stub that has drifted from the
 * contract. It already did once here: the first draft invented `createCheckoutSession` and
 * `tsc` named the three methods that actually exist.
 *
 * These methods are never called — this file tests the plugin seam, not the gateway — so they
 * reject rather than return a plausible-looking value. A stub that answers convincingly is a
 * fake nobody notices leaking into a test that meant to exercise something real.
 */
function stubGateway(): PaymentProvider {
  const unused = (method: string) => (): never => {
    throw new Error(
      `stubGateway.${method} was called; this suite exercises the seam, not the gateway`,
    )
  }
  return {
    name: 'stub',
    createCheckout: unused('createCheckout'),
    verifyWebhook: unused('verifyWebhook'),
    retrieveCheckout: unused('retrieveCheckout'),
    refund: unused('refund'),
  }
}

describe('the real plugin runner is what accepts a plugin', () => {
  it('rejects a value that is not plugin-shaped, with InvalidPluginShapeError', async () => {
    // The seam's own guard. Asserted by class and message, not merely "it throws" — per
    // rules/testing.md § 4.1, and because the next test fails differently on purpose.
    await expect(createPluginRunnerFromConfig([{ name: 'no-register' }])).rejects.toThrow(
      InvalidPluginShapeError,
    )
    await expect(createPluginRunnerFromConfig([{ name: 'no-register' }])).rejects.toThrow(
      /register/i,
    )
  })

  it("surfaces a register that cannot run, as the plugin's own error", async () => {
    // The case that matters and the one no fake reaches: `register` runs against the runner's
    // real child scope. The runner deletes the plugin from its maps and rethrows, so what
    // surfaces is the plugin's error — NOT InvalidPluginShapeError. The two mean different
    // things (a shape the seam refuses, versus a register that cannot run) and a test asserting
    // only "rejects" cannot tell them apart.
    const probesEnumerableKeys = {
      name: 'probes-enumerable-keys',
      register(app: object) {
        if (!Object.keys(app).includes('decorateRequest')) {
          throw new TypeError('probe: app has no decorateRequest')
        }
      },
    }

    await expect(createPluginRunnerFromConfig([probesEnumerableKeys])).rejects.toThrow(TypeError)
    await expect(createPluginRunnerFromConfig([probesEnumerableKeys])).rejects.toThrow(
      /no decorateRequest/,
    )
  })

  it('yields no runner at all for an empty plugin list', async () => {
    // Measured from the 0.48.8 source: the function returns undefined for null, a non-array and
    // [] WITHOUT throwing. Pinned once so a fixture typo that empties an array cannot be misread
    // as a conformance failure by the `toBeDefined()` assertions below.
    await expect(createPluginRunnerFromConfig([])).resolves.toBeUndefined()
  })

  it('accepts @theokit/plugin-payments', async () => {
    const plugin = payments({ providers: { stub: stubGateway() } })

    await expect(createPluginRunnerFromConfig([plugin])).resolves.toBeDefined()
  })

  it('accepts @theokit/plugin-voice', async () => {
    // Default export, unlike the named factories — the shape a consumer's `theo.config.ts`
    // imports. Its `register` is deliberately empty, which makes it the case most likely to be
    // assumed fine, which is why it is asserted.
    //
    // The keys are passed explicitly rather than left to the environment: `voicePlugin()`
    // validates synchronously at construction (boot-time crash over mid-request 500), so with no
    // key it throws VoicePluginConfigError before the runner is ever reached — and this tier must
    // not depend on a credential being set.
    const plugin = voicePlugin({
      stt: { apiKey: 'sk-not-a-real-key-conformance-only' },
      tts: { apiKey: 'sk-not-a-real-key-conformance-only' },
    })

    await expect(createPluginRunnerFromConfig([plugin])).resolves.toBeDefined()
  })
})
