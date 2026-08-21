import { lazy, Suspense } from 'react'

import type { ArtifactRendererProps } from './types.js'

/**
 * WhiteboardArtifact — wraps the `<Whiteboard>` primitive from the
 * `@theokit/ui/whiteboard` subpath (RFC 0001). The subpath isolates
 * roughjs + perfect-freehand peer-deps so apps that don't render
 * whiteboard scenes can tree-shake the engine entirely.
 *
 * If the consumer hasn't installed `@theokit/ui`, the lazy import
 * surfaces a fallback message; the schema layer guarantees `scene` is
 * a non-null JSON object even when the underlying renderer rejects it
 * (the `<Whiteboard>` primitive runs its own validate pass).
 */
// Optional peer subpath — dynamic specifier so TS does not try to
// resolve `@theokit/ui/whiteboard` types at plugin build time.
type WhiteboardComponent = React.ComponentType<{
  data: unknown
  className?: string
  'aria-label'?: string
}>
const Whiteboard = lazy(async () => {
  const specifier = '@theokit/ui/whiteboard'
  const mod = (await import(specifier)) as unknown as {
    Whiteboard: WhiteboardComponent
  }
  return { default: mod.Whiteboard }
})

/**
 * Default renderer for whiteboard-scene artifacts, wrapping the `<Whiteboard>` primitive.
 *
 * The scene is agent-produced data, so it is rendered read-only: this shows a scene, it is not an
 * editing surface.
 */
export function WhiteboardArtifact({ artifact }: ArtifactRendererProps<'whiteboard-scene'>) {
  return (
    <div data-testid="whiteboard-artifact" className="grid h-full min-h-[300px] p-3">
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Loading whiteboard engine…
          </div>
        }
      >
        <Whiteboard
          data={artifact.scene}
          className="h-full w-full rounded-md border"
          aria-label={artifact.title}
        />
      </Suspense>
    </div>
  )
}
