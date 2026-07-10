import type { Artifact } from '../schema.js'
import { ArtifactRenderer } from './artifact-renderer.js'
import { ArtifactVersionRail } from './artifact-version-rail.js'
import type { ArtifactRendererRegistry } from './renderers/types.js'

const NOOP = () => undefined

export interface CanvasArtifactListProps {
  artifact: Artifact | null
  versions: readonly Artifact[] | undefined
  onVersionSelect: ((artifact: Artifact) => void) | undefined
  renderers: ArtifactRendererRegistry | undefined
}

export function CanvasArtifactList({
  artifact,
  versions,
  onVersionSelect,
  renderers,
}: CanvasArtifactListProps) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto">
        {artifact !== null ? (
          <ArtifactRenderer
            key={`${artifact.id}-v${artifact.version}`}
            artifact={artifact}
            renderers={renderers}
          />
        ) : (
          <div
            data-testid="canvas-panel-empty"
            className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground"
          >
            Nothing in the canvas yet. Ask the agent to draw, draft, or compose something.
          </div>
        )}
      </div>
      {artifact !== null && versions !== undefined && versions.length > 1 ? (
        <ArtifactVersionRail
          versions={versions}
          currentVersion={artifact.version}
          onSelect={onVersionSelect ?? NOOP}
        />
      ) : null}
    </div>
  )
}
