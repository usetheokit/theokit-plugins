import { CodeBlock } from '@usetheo/ui'

import type { ArtifactRendererProps } from './types.js'

/**
 * CodeArtifact — delegates to `@theokit/ui/CodeBlock` composite which
 * already handles language label + copy button + (optional) "$ " prefix
 * for terminal output. T2.1 of canvas-ecosystem-refactor.
 */
export function CodeArtifact({ artifact }: ArtifactRendererProps<'code'>) {
  return (
    <div
      data-testid="code-artifact"
      data-language={artifact.language}
      data-terminal={artifact.terminal === true ? 'true' : undefined}
      className="p-3"
    >
      <CodeBlock
        code={artifact.content}
        language={artifact.language}
        terminal={artifact.terminal === true}
        copyable
      />
    </div>
  )
}
