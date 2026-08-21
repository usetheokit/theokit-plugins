import { lazy, Suspense } from 'react'

import type { ArtifactRendererProps } from './types.js'

/**
 * SlideDeckArtifact — wraps the `<SlideDeck>` composite from the
 * `@theokit/ui/slide-deck` subpath (RFC 0003). Streams the markdown
 * source (or pre-parsed slides array) into the deck primitive.
 *
 * The schema accepts either form (`source: string | object[]`) so the
 * agent can publish a quick `# Title\n---\n# Slide 2` draft OR a fully
 * structured array. The downstream primitive validates either.
 */
type SlideDeckComponent = React.ComponentType<{
  slides: unknown
  className?: string
  'aria-label'?: string
}>
const SlideDeck = lazy(async () => {
  const specifier = '@theokit/ui/slide-deck'
  const mod = (await import(specifier)) as unknown as { SlideDeck: SlideDeckComponent }
  return { default: mod.SlideDeck }
})

/**
 * Default renderer for slide-deck artifacts.
 *
 * Presents the deck inline with per-slide navigation rather than opening a viewer, so a deck stays
 * readable next to the conversation that produced it.
 */
export function SlideDeckArtifact({ artifact }: ArtifactRendererProps<'slide-deck'>) {
  return (
    <div data-testid="slide-deck-artifact" className="grid h-full min-h-[400px] p-3">
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Loading slide engine…
          </div>
        }
      >
        <SlideDeck
          slides={artifact.source}
          className="h-full w-full rounded-md border"
          aria-label={artifact.title}
        />
      </Suspense>
    </div>
  )
}
