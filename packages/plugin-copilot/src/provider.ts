/**
 * @theokit/plugin-copilot — Provider extension helper (P#11 public).
 *
 * Pass-through identity for the {@link CopilotRealtimeProvider} structural
 * interface — mirrors the consumer-supplied provider pattern from P#9 D2 /
 * P#10 D2. Lets consumers wire custom RealtimeProvider impls (e.g. Redis,
 * Cloudflare DO) into CopilotRuntime without depending on plugin-realtime
 * peer.
 *
 * @public
 */

import type { CopilotRealtimeProvider } from './types.js'

/**
 * Type-only identity helper. Runtime guards verify the required surface.
 *
 * @public
 */
export function defineCopilotRealtimeProvider(
  impl: CopilotRealtimeProvider,
): CopilotRealtimeProvider {
  if (impl === null || typeof impl !== 'object') {
    throw new TypeError('defineCopilotRealtimeProvider: provider implementation is required')
  }
  const methods = [
    'joinRoom',
    'leaveRoom',
    'broadcast',
    'updatePresence',
    'getPresence',
    'subscribeRoom',
  ] as const
  // Bridge: index by string to runtime-probe without widening the structural
  // interface (CopilotRealtimeProvider has no string index signature by design).
  const indexed = impl as unknown as Record<string, unknown>
  for (const method of methods) {
    if (typeof indexed[method] !== 'function') {
      throw new TypeError(`defineCopilotRealtimeProvider: impl.${method} must be a function`)
    }
  }
  return impl
}
