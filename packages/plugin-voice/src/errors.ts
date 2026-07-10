/**
 * Typed error hierarchy for @theokit/plugin-voice (EC-4 / EC-6).
 *
 * Why a custom hierarchy and not bare Error: the recorder runs in the
 * browser where MediaDevices throws `DOMException` with different `.name`
 * fields ("NotAllowedError" / "NotFoundError" / "NotReadableError" / …).
 * The plugin maps each one to a stable, documented type so UI consumers
 * (VoiceRecorderBar, T3.4) can `catch (e) { if (e instanceof VoicePermissionDeniedError) … }`
 * without parsing message strings — and so the server-side route can do
 * the same for misconfiguration (missing API key).
 *
 * Base class carries:
 *   - `name` constant (matches class name for reflection-style checks)
 *   - actionable `message` (includes the env var name when relevant)
 *   - optional `cause` (Error chain, ES2022) so the original DOMException
 *     is preserved for diagnostic logging.
 */

export class VoicePluginError extends Error {
  override readonly name: string = 'VoicePluginError'
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    // Restore prototype chain on the Error subclass (TypeScript caveat —
    // necessary for `instanceof` to work across transpile boundaries).
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Browser denied microphone access (DOMException.name === "NotAllowedError"). */
export class VoicePermissionDeniedError extends VoicePluginError {
  override readonly name = 'VoicePermissionDeniedError'
}

/** No microphone device available (DOMException.name === "NotFoundError"). */
export class VoiceNoDeviceError extends VoicePluginError {
  override readonly name = 'VoiceNoDeviceError'
}

/**
 * Plugin construction received invalid configuration (e.g. missing
 * `OPENAI_API_KEY` env var or explicit `apiKey` opt).
 * Surfaces synchronously at `voicePlugin(opts)` call site so the
 * application fails fast on boot, not mid-request.
 */
export class VoicePluginConfigError extends VoicePluginError {
  override readonly name = 'VoicePluginConfigError'
}

/**
 * Upstream STT/TTS provider returned a non-2xx response.
 * Includes the provider name and HTTP status so the consumer can
 * differentiate quota errors (429) from auth (401) from server-side
 * faults (5xx).
 */
export class VoiceProviderError extends VoicePluginError {
  override readonly name = 'VoiceProviderError'
  readonly provider: string
  readonly status: number
  constructor(provider: string, status: number, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.provider = provider
    this.status = status
  }
}
