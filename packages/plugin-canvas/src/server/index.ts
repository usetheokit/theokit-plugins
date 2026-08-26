/**
 * Server-side entrypoint of `@theokit/plugin-canvas`.
 *
 * Import via:
 *
 *     import { createArtifactBus } from '@theokit/plugin-canvas/server'
 *
 * Re-exports only server-safe modules — never pulls React UI.
 */

export { createArtifactBus, type ArtifactBus, type ArtifactBusHandler } from './artifact-bus.js'

export { ArtifactsControllerBase } from './artifacts-controller.js'
