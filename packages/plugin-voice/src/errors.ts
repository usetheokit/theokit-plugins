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
 * The caller handed `transcribe()` / `synthesize()` input the plugin refuses before any provider
 * call. `code` is the same stable code the HTTP handlers answer with: `INVALID_AUDIO`,
 * `INVALID_BODY`, `INPUT_TOO_LONG`, `INVALID_VOICE` or `INVALID_SPEED`.
 */
export class VoiceInputError extends VoicePluginError {
  override readonly name = 'VoiceInputError'
  readonly code: string
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.code = code
  }
}

/**
 * Upstream STT/TTS provider call failed.
 * Includes the provider name and HTTP status so the consumer can
 * differentiate quota errors (429) from auth (401) from server-side
 * faults (5xx). `status` is 0 when no response arrived (timeout, network).
 * `code` is one of `UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK`, `UPSTREAM_ERROR`,
 * `UPSTREAM_PARSE`, `UPSTREAM_EMPTY`. `upstreamBody` holds a truncated copy of a
 * non-2xx body for server-side logs; it is never part of `message`.
 */
export class VoiceProviderError extends VoicePluginError {
  override readonly name = 'VoiceProviderError'
  readonly provider: string
  readonly status: number
  readonly code: string | undefined
  readonly upstreamBody: string | undefined
  constructor(
    provider: string,
    status: number,
    message: string,
    options?: { cause?: unknown; code?: string; upstreamBody?: string },
  ) {
    super(message, options)
    this.provider = provider
    this.status = status
    this.code = options?.code
    this.upstreamBody = options?.upstreamBody
  }
}
