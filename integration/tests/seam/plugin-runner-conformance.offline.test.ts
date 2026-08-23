/**
 * Every package the registry declares `seam: 'plugin'`, handed to the runner TheoKit uses.
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
 * Measured against theokit 0.48.8 — NOT pinned to it: `integration/package.json` declares the
 * range `^0.48.7`, and the lockfile happens to resolve 0.48.8. An upgrade inside 0.48.x can move
 * the seam under this comment. The failures below name the seam rather than the package, so when
 * that happens the reader is pointed at the framework first.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzleDb } from '@theokit/plugin-db-drizzle'
import { payments } from '@theokit/plugin-payments'
import type { PaymentProvider } from '@theokit/plugin-payments'
import voicePlugin from '@theokit/plugin-voice'
import { InvalidPluginShapeError, createPluginRunnerFromConfig } from 'theokit/server/plugins'
import { describe, expect, it } from 'vitest'

import { INTEGRATING_PACKAGES } from '../../src/integrating-packages.js'

/** Repo root, resolved from this file — vitest's cwd is `integration/`. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Minimal payments gateway — the plugin needs one provider to build at all.
 *
 * Typed as the real `PaymentProvider`, so the compiler rejects a stub that has drifted from the
 * contract. It already did once here: the first draft invented `createCheckoutSession`, and tsc
 * named the four methods that actually exist (`createCheckout`, `verifyWebhook`,
 * `retrieveCheckout`, `refund`).
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

/**
 * How to build each locally-covered plugin. Keyed by the registry's `pkg`, so adding a row
 * without adding a factory (or a `coveredBy`) fails rather than being skipped.
 */
// `unknown` is the honest element type: the seam itself takes `unknown` and validates at
// runtime, which is the whole reason this suite exists.
const PLUGIN_FACTORIES: Record<string, () => unknown> = {
  'plugin-payments': () => payments({ providers: { stub: stubGateway() } }),
  // Keys are explicit rather than left to the environment: voicePlugin() validates
  // synchronously at construction (boot-time crash over mid-request 500), so with no key it
  // throws VoicePluginConfigError before the runner is ever reached — and this tier must not
  // depend on a credential being set.
  'plugin-voice': () =>
    voicePlugin({
      stt: { apiKey: 'sk-not-a-real-key-conformance-only' },
      tts: { apiKey: 'sk-not-a-real-key-conformance-only' },
    }),
  // The plan carried this as its one open question: this package drives an external binary and
  // the offline tier must stay credential-free. Measured instead of assumed — the module
  // imports in ~4ms and this call builds without touching the filesystem or shelling out. No
  // URL is passed, and the plugin deliberately does not read env at construction.
  'plugin-db-drizzle': () => drizzleDb({ driver: 'postgres' }),
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

  // --- driven by the registry, so a row without a case cannot pass ---
  //
  // The previous version hand-wrote one `it` per package. That gated membership only: a new
  // `{ pkg: 'plugin-search', seam: 'plugin' }` row passed every exhaustiveness assertion while no
  // test anywhere exercised it — the cheaper half of the property ADR D2 claimed. Iterating the
  // registry here is what makes the claim true.
  const pluginRows = INTEGRATING_PACKAGES.filter((entry) => entry.seam === 'plugin')

  it('declares at least one plugin package, so the loop below is not empty', () => {
    expect(pluginRows.length).toBeGreaterThan(0)
  })

  for (const row of pluginRows) {
    it(`accepts @theokit/${row.pkg}`, async () => {
      const build = PLUGIN_FACTORIES[row.pkg]

      if (!build) {
        // No local fixture: the row must point at a conformance case that exists elsewhere.
        expect(
          row.coveredBy,
          `${row.pkg} is declared seam:'plugin' but nothing builds it here and it names no coveredBy`,
        ).toBeTruthy()
        expect(
          existsSync(join(REPO_ROOT, row.coveredBy!)),
          `${row.pkg} names ${row.coveredBy} as its conformance case, and that file does not exist`,
        ).toBe(true)
        return
      }

      await expect(createPluginRunnerFromConfig([build()])).resolves.toBeDefined()
    })
  }

  it('accepts every plugin package together, the way a consumer wires them', async () => {
    // A consumer's `theo.config.ts` passes one array, not one plugin. Registering them together
    // is the only way the seam's cross-package behaviour is exercised at all — decoration keys
    // share a namespace, and theokit 0.48.8 resolves a collision last-writer-wins rather than
    // throwing (DuplicateDecorationError is still exported but never constructed). Nothing
    // collides today; this case is what would notice when something does.
    const built = Object.values(PLUGIN_FACTORIES).map((build) => build())

    await expect(createPluginRunnerFromConfig(built)).resolves.toBeDefined()
  })
})
