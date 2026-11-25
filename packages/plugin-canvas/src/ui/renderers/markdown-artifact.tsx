import { Markdown } from '@theokit/ui'

import type { ArtifactRendererProps } from './types.js'

const ALLOWED_PROTOCOLS = ['http', 'https', 'mailto'] as const

/**
 * Default renderer for markdown artifacts.
 *
 * Renders through the sanitized GFM pipeline of `@theokit/ui` (raw HTML is never rendered, links
 * are limited to http, https and mailto). An app wanting footnotes or custom directives registers
 * its own renderer through {@link ArtifactRendererRegistry}.
 */
export function MarkdownArtifact({ artifact }: ArtifactRendererProps<'markdown'>) {
  return (
    <div data-testid="markdown-artifact" className="max-w-none p-4 text-sm">
      <Markdown source={artifact.content} allowedProtocols={ALLOWED_PROTOCOLS} />
    </div>
  )
}
