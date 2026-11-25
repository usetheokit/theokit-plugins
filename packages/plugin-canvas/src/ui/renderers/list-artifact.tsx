import type { ArtifactRendererProps } from './types.js'

/**
 * ListArtifact — an ordered or unordered list. Items are plain text and
 * are rendered as React text nodes, never as HTML or markdown.
 */
export function ListArtifact({ artifact }: ArtifactRendererProps<'list'>) {
  const Tag = artifact.ordered === true ? 'ol' : 'ul'
  return (
    <div data-testid="list-artifact" className="p-3">
      <Tag className={artifact.ordered === true ? 'list-decimal pl-5' : 'list-disc pl-5'}>
        {artifact.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </Tag>
    </div>
  )
}
