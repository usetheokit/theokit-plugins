import { renderMarkdown } from './markdown.js'
import type { ArtifactRendererProps } from './types.js'

export function MarkdownArtifact({ artifact }: ArtifactRendererProps<'markdown'>) {
  return (
    <div data-testid="markdown-artifact" className="prose max-w-none p-4 text-sm dark:prose-invert">
      {renderMarkdown(artifact.content)}
    </div>
  )
}
