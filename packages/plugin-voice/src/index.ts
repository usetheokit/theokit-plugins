/**
 * @theokit/plugin-voice — voice (STT + TTS) plugin for TheoKit.
 *
 * Architecture (0.5.0 — corrected after T3.5 dogfood):
 *
 *   The handlers accept an already-parsed input + resolved config and
 *   return a Fetch `Response` (the caller extracts audio/JSON from the
 *   inbound request — theokit's `defineRoute` already parses the body):
 *     `handleSttRequest(input: SttInput, config, opts?): Promise<Response>`
 *     `handleTtsRequest(input: TtsInput, config, opts?): Promise<Response>`
 *
 *   Consumers wire them via a 12-line `defineRoute` stub per endpoint
 *   in `server/routes/voice/{stt,tts}.ts`. The plugin still ships
 *   `voicePlugin()` so the consumer keeps a single registration line in
 *   `theo.config.ts` — its job is now **boot-time config validation
 *   only** (EC-6 fail-fast on missing API key).
 *
 *   Why we no longer intercept via `onRequest` hooks: the framework's
 *   `api-middleware.ts` (`api-middleware.ts:279`) returns 404 BEFORE
 *   the plugin runner is invoked for paths that have no matching
 *   `server/routes/` file. A hook therefore cannot OWN a previously
 *   non-existent URL. Plugin-cors works because it ALSO has a direct
 *   pre-router handler (`corsHandler?.handlePreflight`) wired into the
 *   middleware as a special case — not via the plugin runner. To stay
 *   honest and to give the user observable, framework-aware routing,
 *   we lean on `defineRoute` shims instead of a framework patch.
 */
// theokit M31: `defineTheoPlugin` (value) is internalized; the `TheoPlugin` type
// remains public on the `theokit/server` barrel. Type-only import is erased at
// build, so it carries no runtime coupling to the deprecated umbrella entry.
import type { TheoPlugin } from 'theokit/server'

import { validateVoiceOptions, type VoiceConfig, type VoiceOptions } from './options.js'

export { handleSttRequest } from './server/stt-server.js'
export { handleTtsRequest } from './server/tts-server.js'
export type { SttAudio, SttHandlerOptions, SttInput, SttResponseBody } from './server/stt-server.js'
export type { TtsHandlerOptions, TtsInput } from './server/tts-server.js'

export {
  createRecorder,
  type CreateRecorderOptions,
  type Recorder,
  type RecorderState,
} from './recorder.js'
export type { VoiceConfig, VoiceOptions, ResolvedVoiceOptions } from './options.js'
export {
  VoiceNoDeviceError,
  VoicePermissionDeniedError,
  VoicePluginConfigError,
  VoicePluginError,
  VoiceProviderError,
} from './errors.js'

/**
 * Resolve voice configuration and validate API keys synchronously.
 * Use this when you want fail-fast boot-time validation without
 * registering the no-op `voicePlugin()` in `theo.config.ts`.
 */
export function resolveVoiceConfig(options: VoiceOptions = {}): VoiceConfig {
  return validateVoiceOptions(options)
}

/**
 * Register a no-op TheoKit plugin that validates the voice config at
 * boot. Call once from `theo.config.ts > plugins`. Its only side effect
 * is to throw `VoicePluginConfigError` synchronously when the STT or
 * TTS API key is missing — surfacing the misconfiguration on the dev
 * server's first console line, not on the first user click.
 *
 * The hook is intentionally a no-op: the framework runs plugin hooks
 * AFTER route matching (see api-middleware.ts:279), so any per-request
 * logic must live inside a `defineRoute` shim under
 * `server/routes/voice/`.
 */
export default function voicePlugin(options: VoiceOptions = {}): TheoPlugin {
  // EC-6: validate synchronously — boot-time crash beats mid-request 500.
  validateVoiceOptions(options)
  // theokit M31 internalized defineTheoPlugin (the `plugin()` builder is the
  // public surface). The wrapper was a pure identity, so return the typed
  // object directly — no runtime dependency on the deprecated umbrella export.
  const plugin: TheoPlugin = {
    name: '@theokit/plugin-voice',
    register() {
      // intentionally empty — see file docstring
    },
  }
  return plugin
}

// Re-exported helper signatures for runtime parity with the prior API.
// The route shim per endpoint is the canonical wire-up; these stay so
// existing imports don't break during the 0.4.0 → 0.5.0 migration.
export interface VoicePluginRuntimeOptions {
  // No runtime knobs at the plugin level — handler-level options live
  // next to each `handleXxxRequest` call site.
  _: never
}
