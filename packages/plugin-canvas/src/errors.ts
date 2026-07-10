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

export class CanvasArtifactNotFoundError extends CanvasPluginError {
  override readonly name = 'CanvasArtifactNotFoundError'
  readonly artifactId: string
  constructor(artifactId: string) {
    super(`Artifact "${artifactId}" not found.`)
    this.artifactId = artifactId
  }
}

export class CanvasArtifactSecurityError extends CanvasPluginError {
  override readonly name = 'CanvasArtifactSecurityError'
  readonly reason: string
  constructor(message: string, reason: string, options?: { cause?: unknown }) {
    super(message, options)
    this.reason = reason
  }
}
