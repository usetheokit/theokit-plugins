/**
 * @theokit/plugin-copilot — Voice bridge (P#11 internal opt-in).
 *
 * Per ADR D8 — plugin-voice opt-in via runtime peer check. Dynamic import
 * with actionable error if voice config set but peer missing.
 *
 * @internal
 */

import type { CopilotVoiceConfig } from '../types.js'
import { CopilotConfigError } from '../types.js'

/**
 * Check plugin-voice peer availability at runtime when voice config provided.
 * Returns truthy structural module reference OR throws actionable error.
 *
 * @internal
 */
export async function ensureVoicePeer(
  config: CopilotVoiceConfig | undefined,
): Promise<{ enabled: boolean }> {
  if (config === undefined) return { enabled: false }
  if (config.transcribeWith === undefined && config.speakWith === undefined) {
    return { enabled: false }
  }
  try {
    // Optional peer — resolved at runtime, intentionally hidden from the
    // type checker since the consumer may or may not have it installed.
    // @ts-expect-error optional peer (peerDependenciesMeta.optional = true)
    await import('@theokit/plugin-voice')
    return { enabled: true }
  } catch (cause) {
    throw new CopilotConfigError(
      'voice configuration provided but `@theokit/plugin-voice` peer not installed. Run `pnpm add @theokit/plugin-voice` to enable STT/TTS, OR remove the `voice` key from defineCopilot.',
      { code: 'plugin-voice_missing', cause },
    )
  }
}
