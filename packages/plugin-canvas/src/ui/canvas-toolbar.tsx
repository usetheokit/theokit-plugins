import { Button, CopyButton, Tooltip } from '@theokit/ui'

import type { Artifact } from '../schema.js'
import type { CanvasPanelToolbarAction } from './canvas-panel-actions.js'

export interface CanvasToolbarProps {
  artifact: Artifact | null
  copyText: string
  hidden: ReadonlySet<CanvasPanelToolbarAction>
  onDownload: () => void
  onFork: (() => void) | undefined
  onClose: () => void
}

export function CanvasToolbar({
  artifact,
  copyText,
  hidden,
  onDownload,
  onFork,
  onClose,
}: CanvasToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {artifact !== null && !hidden.has('copy') ? (
        <CopyButton
          value={copyText}
          variant="outline"
          size="sm"
          label="Copy"
          data-testid="canvas-toolbar-copy"
          aria-label="Copy artifact content"
        />
      ) : null}
      {artifact !== null && !hidden.has('download') ? (
        <Tooltip label="Download artifact">
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownload}
            data-testid="canvas-toolbar-download"
            aria-label="Download artifact"
          >
            Download
          </Button>
        </Tooltip>
      ) : null}
      {artifact !== null && onFork !== undefined && !hidden.has('fork') ? (
        <Tooltip label="Fork artifact">
          <Button
            variant="secondary"
            size="sm"
            onClick={onFork}
            data-testid="canvas-toolbar-fork"
            aria-label="Fork artifact"
          >
            Fork
          </Button>
        </Tooltip>
      ) : null}
      {!hidden.has('close') ? (
        <Tooltip label="Close canvas panel">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            data-testid="canvas-toolbar-close"
            aria-label="Close canvas panel"
          >
            ✕
          </Button>
        </Tooltip>
      ) : null}
    </div>
  )
}
