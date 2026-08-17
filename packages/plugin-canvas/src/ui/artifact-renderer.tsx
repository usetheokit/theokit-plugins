import { Alert } from '@usetheo/ui'

import type { Artifact } from '../schema.js'
import { DEFAULT_RENDERERS } from './renderers/index.js'
import type { ArtifactRendererComponent, ArtifactRendererRegistry } from './renderers/types.js'

export interface ArtifactRendererProps {
  artifact: Artifact
  /**
   * Per-kind override map. Apps register custom renderers (e.g. a
   * project-specific markdown engine with full GFM, or a syntax-
   * highlighted CodeArtifact via Shiki). Unknown keys are ignored;
   * unspecified kinds fall back to the default renderer.
   */
  renderers?: ArtifactRendererRegistry
}

/**
 * Dispatcher — renders the right per-kind component for a given
 * artifact. Unknown kinds (e.g. an app shipped a forward-compatible
 * artifact from a future plugin version) render a diagnostic block so
 * the operator can SEE the unknown payload instead of silently dropping.
 *
 * Renderer registry pattern:
 *
 *   ```tsx
 *   <ArtifactRenderer
 *     artifact={a}
 *     renderers={{
 *       code: ShikiCodeArtifact, // override default
 *       audio: AudioArtifact,    // add new kind (compile-time error
 *                                // unless extended via module augmentation)
 *     }}
 *   />
 *   ```
 *
 * Tree-shaking: imports are static so all 9 default renderers ship in
 * any consumer bundle that uses the dispatcher. Apps that need a tiny
 * surface can import the individual renderers directly:
 * `import { CodeArtifact } from '@theokit/plugin-canvas/ui'` and skip
 * the dispatcher entirely.
 */
export function ArtifactRenderer({ artifact, renderers }: ArtifactRendererProps) {
  const merged: ArtifactRendererRegistry = { ...DEFAULT_RENDERERS, ...renderers }
  const Renderer = merged[artifact.kind] as ArtifactRendererComponent | undefined
  if (Renderer === undefined) {
    return (
      <div data-testid="artifact-renderer-unknown" className="p-3">
        <Alert
          intent="warning"
          title={`Unknown artifact kind: ${artifact.kind}`}
          description={
            <pre className="mt-2 overflow-auto font-mono text-[0.7rem] opacity-80">
              {JSON.stringify(artifact, null, 2)}
            </pre>
          }
        />
      </div>
    )
  }
  // The registry lookup loses the discriminated narrowing — Renderer is
  // typed as `ArtifactRendererComponent` (the generic default) but the
  // runtime dispatch guarantees it receives the matching variant.
  const SafeRenderer = Renderer as (props: { artifact: Artifact }) => React.ReactElement | null
  return (
    <div
      data-testid="artifact-renderer"
      data-kind={artifact.kind}
      data-version={artifact.version}
      data-artifact-id={artifact.id}
      className="grid h-full"
    >
      <SafeRenderer artifact={artifact} />
    </div>
  )
}
