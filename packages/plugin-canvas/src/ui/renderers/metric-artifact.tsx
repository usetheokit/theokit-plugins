import type { ArtifactRendererProps } from './types.js'

/**
 * MetricArtifact — one number with a label, an optional unit and an
 * optional delta. All fields are plain text rendered as text nodes.
 */
export function MetricArtifact({ artifact }: ArtifactRendererProps<'metric'>) {
  return (
    <div data-testid="metric-artifact" className="grid gap-1 p-3">
      <div className="text-muted-foreground text-sm">{artifact.label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-semibold" data-testid="metric-value">
          {artifact.value}
        </span>
        {artifact.unit !== undefined && <span className="text-sm">{artifact.unit}</span>}
        {artifact.delta !== undefined && (
          <span className="ml-2 text-sm" data-testid="metric-delta">
            {artifact.delta}
          </span>
        )}
      </div>
    </div>
  )
}
