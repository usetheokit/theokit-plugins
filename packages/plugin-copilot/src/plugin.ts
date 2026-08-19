/**
 * @theokit/plugin-copilot — the TheoKit plugin surface (#42 item 3, #62 scope 3).
 *
 * Until now this package declared `theokit` as a required peer and imported nothing from
 * it. That was triaged rather than overlooked — `plugin-copilot` sat in
 * `PEER_WITHOUT_USE_EXEMPT` with the plan written down: *"Holds a CopilotRuntime, which is
 * the obvious ctx decoration. Deferred with payments/db-drizzle done first as the
 * reference shape."* This is that decoration, and `plugin-payments/src/plugin.ts` is the
 * shape it follows.
 *
 * @public
 */

import type { TheoApp, TheoPlugin } from 'theokit/server'

import { CopilotRuntime, type CopilotRuntimeOptions } from './internal/runtime.js'
import type { CopilotDescriptor } from './types.js'

export type { TheoApp, TheoPlugin }

/**
 * What a route handler reaches through `ctx.copilot`.
 *
 * Read-only, and deliberately so. The runtime can register, activate and deactivate
 * copilots; a request handler has no business doing any of that, because a route that
 * deactivates a copilot mid-flight acts on state belonging to the process rather than to
 * the request.
 *
 * There is no `invoke` here either, and its absence is the honest part: a copilot is
 * triggered by room frames — `broadcast:*`, `presence:idle` — not by HTTP. Adding an
 * invoke would have meant inventing a runtime method to back it, which is the exact
 * defect #42 recorded (a plugin typed against an API the framework never had).
 *
 * @public
 */
export interface CopilotRequestSurface {
  /**
   * Committed and in-flight spend for a copilot, or `undefined` when the id is unknown.
   *
   * `undefined` rather than a throw: a usage panel rendering a stale id should show a
   * gap, not fail the request.
   */
  usage(
    copilotId: string,
  ): { dailyUsedUsd: number; monthlyUsedUsd: number; inFlightUsd: number } | undefined
  /** Ids of the copilots this app registered. */
  readonly ids: readonly string[]
  /** The descriptor behind an id — identity, room, triggers — or `undefined`. */
  get(copilotId: string): CopilotDescriptor | undefined
}

/** The key `ctx.copilot` is published under. Fixed, so a handler can rely on it. */
export const COPILOT_DECORATION_KEY = 'copilot'

/**
 * @public
 */
export interface CopilotPlugin extends TheoPlugin {
  readonly name: '@theokit/plugin-copilot'
  readonly kind: 'copilot'
  /** The runtime this plugin owns — exposed for wiring that outlives a request. */
  readonly runtime: CopilotRuntime
  /**
   * Publish {@link CopilotRequestSurface} on `ctx.copilot`.
   *
   * `TheoApp` and `TheoPlugin` are imported type-only, so the framework stays a
   * compile-time contract — `import type` is erased at build. No route is registered
   * because a plugin CANNOT register one: `TheoApp` offers `addHook` and
   * `decorateRequest`, and nothing else (#42). No hook either, and that is the choice: a
   * copilot plugin adding an onRequest hook would run on every request in the app,
   * including the ones that never speak to an agent.
   */
  register(app: TheoApp): void
}

/**
 * Wire a copilot runtime into a TheoKit app.
 *
 * ```ts
 * // theo.config.ts
 * import { copilot } from '@theokit/plugin-copilot'
 * import { createMemoryRealtimeProvider } from '@theokit/plugin-realtime'
 *
 * export default { plugins: [copilot({ provider, agent, copilots: [helper] })] }
 * ```
 *
 * ```ts
 * // a route handler rendering a usage meter
 * const spend = ctx.copilot.usage('helper')
 * ```
 *
 * @public
 */
export function copilot(options: CopilotRuntimeOptions): CopilotPlugin {
  const runtime = new CopilotRuntime(options)

  const surface: CopilotRequestSurface = {
    usage: (copilotId) => runtime.getUsage(copilotId),
    get: (copilotId) => runtime.getCopilot(copilotId),
    get ids() {
      return runtime.listCopilotIds()
    },
  }

  return {
    name: '@theokit/plugin-copilot',
    kind: 'copilot',
    runtime,
    register(app: TheoApp): void {
      app.decorateRequest<CopilotRequestSurface>(COPILOT_DECORATION_KEY, surface)
    },
  }
}
