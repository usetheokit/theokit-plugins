/**
 * @theokit/plugin-copilot — Canvas bridge (P#11 internal opt-in).
 *
 * Per ADR D8 — plugin-canvas opt-in via runtime peer check.
 *
 * @internal
 */

import type { CopilotCanvasConfig } from '../types.js'
import { CopilotConfigError } from '../types.js'

/**
 * Check plugin-canvas peer availability at runtime when canvas config provided.
 *
 * @internal
 */
export async function ensureCanvasPeer(
  config: CopilotCanvasConfig | undefined,
): Promise<{ enabled: boolean }> {
  if (config === undefined || !config.emitArtifacts) {
    return { enabled: false }
  }
  try {
    // Optional peer — resolved at runtime, intentionally hidden from the
    // type checker since the consumer may or may not have it installed.
    // @ts-expect-error optional peer (peerDependenciesMeta.optional = true)
    await import('@theokit/plugin-canvas')
    return { enabled: true }
  } catch (cause) {
    throw new CopilotConfigError(
      'canvas configuration enabled but `@theokit/plugin-canvas` peer not installed. Run `pnpm add @theokit/plugin-canvas` to enable artifact emission, OR set `canvas.emitArtifacts: false`.',
      { code: 'plugin-canvas_missing', cause },
    )
  }
}
