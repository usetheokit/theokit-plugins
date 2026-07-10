import { DiffViewer, type DiffHunk } from '@theokit/ui'

import type { ArtifactRendererProps } from './types.js'

/**
 * DiffArtifact — delegates to `@theokit/ui/DiffViewer` primitive.
 * Artifact's `hunks` shape is identical to `DiffHunk[]` (same id/header/lines
 * with kind+oldNumber+newNumber+content), so no adapter needed. T2.2 of
 * canvas-ecosystem-refactor.
 */
export function DiffArtifact({ artifact }: ArtifactRendererProps<'diff'>) {
  return (
    <div data-testid="diff-artifact" className="p-3">
      <DiffViewer
        path={artifact.path}
        stats={artifact.stats}
        hunks={artifact.hunks}
      />
    </div>
  )
}
