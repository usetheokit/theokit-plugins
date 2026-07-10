/**
 * Browser-only UI surface for @theokit/plugin-canvas.
 *
 * Public API:
 *   - `<ArtifactRenderer>` — dispatcher with renderer registry override
 *   - per-kind renderers exported individually for tree-shaking
 *   - schema + error re-exports so consumers don't need both subpaths
 */
export { ArtifactRenderer, type ArtifactRendererProps } from './artifact-renderer.js'
export {
  CanvasPanel,
  type CanvasPanelProps,
} from './canvas-panel.js'
export type { CanvasPanelToolbarAction } from './canvas-panel-actions.js'
export {
  ArtifactVersionRail,
  type ArtifactVersionRailProps,
} from './artifact-version-rail.js'
export {
  serializeArtifactForCopy,
  artifactToBlob,
  filenameFor,
  pickExtension,
  slugifyFilename,
} from './artifact-actions.js'
export {
  useCanvas,
  type UseCanvasOptions,
  type UseCanvasState,
} from './use-canvas.js'
export {
  OpenInCanvasButton,
  type OpenInCanvasButtonProps,
} from './open-in-canvas-button.js'
export {
  extractArtifactCandidates,
  type ArtifactCandidate,
  type ExtractContext,
} from './extract-artifacts.js'

export {
  DEFAULT_RENDERERS,
  CodeArtifact,
  DiffArtifact,
  HtmlArtifact,
  ImageArtifact,
  MarkdownArtifact,
  MermaidArtifact,
  SlideDeckArtifact,
  SvgArtifact,
  WhiteboardArtifact,
  type ArtifactRendererProps as ArtifactKindRendererProps,
  type ArtifactRendererComponent,
  type ArtifactRendererRegistry,
} from './renderers/index.js'

export { sanitizeSvg, sanitizeHtmlSrcdoc, type SanitizeReport } from './renderers/sanitize.js'

export {
  artifactSchema,
  ARTIFACT_KINDS,
  validateArtifact,
  isArtifact,
  enforceArtifactSecurity,
  type Artifact,
  type ArtifactKind,
  type ArtifactEnvelope,
  type HtmlSandboxMode,
} from '../schema.js'

export {
  CanvasPluginError,
  CanvasArtifactValidationError,
  CanvasArtifactNotFoundError,
  CanvasArtifactSecurityError,
} from '../errors.js'
