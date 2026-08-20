/**
 * Typed error hierarchy for @theokit/plugin-canvas.
 *
 * Mirrors the plugin-voice pattern: a base class + 3 stable subclasses
 * apps can use for `instanceof` switches without parsing message
 * strings. Subclasses cover the boundaries that produce typed errors:
 *
 *  - `CanvasArtifactValidationError`  — Zod rejected the artifact shape
 *  - `CanvasArtifactNotFoundError`    — store lookup by id failed
 *  - `CanvasArtifactSecurityError`    — boundary check blocked a payload
 *                                       (oversized data URL, http://
 *                                       URL on image, SVG with script,
 *                                       html srcdoc with disallowed
 *                                       sandbox combination, etc.)
 */

export class CanvasPluginError extends Error {
  override readonly name: string = 'CanvasPluginError'
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * The artifact did not match {@link artifactSchema}.
 *
 * `issues` carries the per-path failures so a caller can report which field was wrong without
 * parsing the message.
 */
export class CanvasArtifactValidationError extends CanvasPluginError {
  override readonly name = 'CanvasArtifactValidationError'
  readonly issues: readonly { path: string; message: string }[]
  constructor(
    message: string,
    issues: readonly { path: string; message: string }[],
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.issues = issues
  }
}

/**
 * No artifact is stored under this id.
 *
 * `artifactId` is kept as a field so a handler can answer 404 with the id it looked up, rather than
 * re-deriving it from the message.
 */
export class CanvasArtifactNotFoundError extends CanvasPluginError {
  override readonly name = 'CanvasArtifactNotFoundError'
  readonly artifactId: string
  constructor(artifactId: string) {
    super(`Artifact "${artifactId}" not found.`)
    this.artifactId = artifactId
  }
}

/**
 * A boundary check refused the payload — an oversized data URL, a plaintext `http://` image, an SVG
 * carrying script, an HTML srcdoc asking for a sandbox combination that would let it escape.
 *
 * Distinct from a validation error on purpose: the shape was well-formed and was rejected anyway.
 * `reason` names which check blocked it, so this can be logged as a security event rather than
 * counted as ordinary bad input.
 */
export class CanvasArtifactSecurityError extends CanvasPluginError {
  override readonly name = 'CanvasArtifactSecurityError'
  readonly reason: string
  constructor(message: string, reason: string, options?: { cause?: unknown }) {
    super(message, options)
    this.reason = reason
  }
}
