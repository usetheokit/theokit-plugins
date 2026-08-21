/**
 * Renderer registry — the dispatcher source of truth.
 *
 * Default registry maps each artifact kind to its per-kind component.
 * Apps override or extend via `<ArtifactRenderer renderers={...}>`:
 *
 *   ```tsx
 *   <ArtifactRenderer
 *     artifact={a}
 *     renderers={{ code: MyCustomCodeArtifact }}
 *   />
 *   ```
 *
 * Renderers are imported eagerly so a synchronous fallback path is
 * always available. The two engines that pull peer deps
 * (`whiteboard`, `slide-deck`) lazy-load their @theokit/ui subpaths
 * internally so the registry itself stays cheap.
 */
import { CodeArtifact } from './code-artifact.js'
import { DiffArtifact } from './diff-artifact.js'
import { HtmlArtifact } from './html-artifact.js'
import { ImageArtifact } from './image-artifact.js'
import { MarkdownArtifact } from './markdown-artifact.js'
import { MermaidArtifact } from './mermaid-artifact.js'
import { SlideDeckArtifact } from './slide-deck-artifact.js'
import { SvgArtifact } from './svg-artifact.js'
import { WhiteboardArtifact } from './whiteboard-artifact.js'

import type { ArtifactRendererRegistry } from './types.js'

/**
 * The renderer used for each kind when an app supplies no override.
 *
 * Typed `Required<…>`, so adding a kind to {@link ArtifactKind} without a renderer here fails to
 * compile rather than falling through to a JSON dump at runtime.
 */
export const DEFAULT_RENDERERS: Required<ArtifactRendererRegistry> = {
  markdown: MarkdownArtifact,
  code: CodeArtifact,
  diff: DiffArtifact,
  svg: SvgArtifact,
  'whiteboard-scene': WhiteboardArtifact,
  'slide-deck': SlideDeckArtifact,
  mermaid: MermaidArtifact,
  html: HtmlArtifact,
  image: ImageArtifact,
}

export { CodeArtifact } from './code-artifact.js'
export { DiffArtifact } from './diff-artifact.js'
export { HtmlArtifact } from './html-artifact.js'
export { ImageArtifact } from './image-artifact.js'
export { MarkdownArtifact } from './markdown-artifact.js'
export { MermaidArtifact } from './mermaid-artifact.js'
export { SlideDeckArtifact } from './slide-deck-artifact.js'
export { SvgArtifact } from './svg-artifact.js'
export { WhiteboardArtifact } from './whiteboard-artifact.js'
export type {
  ArtifactRendererProps,
  ArtifactRendererComponent,
  ArtifactRendererRegistry,
} from './types.js'
