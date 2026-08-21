import { renderMarkdown } from './markdown.js'
import type { ArtifactRendererProps } from './types.js'

/**
 * Default renderer for markdown artifacts.
 *
 * Deliberately conservative in what it renders. An app wanting full GFM, footnotes or custom
 * directives registers its own renderer through {@link ArtifactRendererRegistry} rather than this
 * one growing options.
 */
export function MarkdownArtifact({ artifact }: ArtifactRendererProps<'markdown'>) {
  return (
    <div data-testid="markdown-artifact" className="prose max-w-none p-4 text-sm dark:prose-invert">
      {renderMarkdown(artifact.content)}
    </div>
  )
}
