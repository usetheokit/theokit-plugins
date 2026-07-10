import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { Artifact } from '../schema.js'
import { artifactToBlob, filenameFor, serializeArtifactForCopy } from './artifact-actions.js'
import { CanvasToolbar } from './canvas-toolbar.js'
import { CanvasArtifactList } from './canvas-artifact-list.js'
import type { ArtifactRendererRegistry } from './renderers/types.js'
import type { CanvasPanelToolbarAction } from './canvas-panel-actions.js'

export interface CanvasPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artifact: Artifact | null
  /** All versions of the current artifact id, ordered ascending. */
  versions?: readonly Artifact[]
  /** Called when the user picks a version pill. */
  onVersionSelect?: (artifact: Artifact) => void
  /** Per-kind renderer overrides (forwards to ArtifactRenderer). */
  renderers?: ArtifactRendererRegistry
  /**
   * Optional fork handler — when supplied, the toolbar shows a Fork
   * button. Receives the current artifact; the consumer is responsible
   * for publishing a new version.
   */
  onFork?: (artifact: Artifact) => void
  /**
   * Hide individual toolbar actions. Default = all visible when the
   * underlying capability is available (e.g. fork only renders when
   * `onFork` is provided regardless of this prop).
   */
  hideActions?: readonly CanvasPanelToolbarAction[]
  className?: string
  /** Override the inner aria-label for the artifact title region. */
  'aria-label'?: string
}

/**
 * `<CanvasPanel>` — controlled side surface that mounts an
 * `<ArtifactRenderer>` alongside the chat. Stays a thin orchestrator:
 *
 *   - controlled `open` / `onOpenChange` so the consumer owns layout
 *     (sheet, drawer, persistent column — your call)
 *   - non-modal: `role="complementary"`, no focus trap; the user can
 *     still type in the chat composer while the panel is open
 *   - Esc closes via a document-level keydown listener that auto-
 *     unbinds on close OR unmount (single source of truth for cleanup)
 *   - per-kind toolbar serialisation flows through `artifact-actions.ts`
 *     so this file owns only the React glue
 *
 * Renders nothing when closed (returns `null`); callers wrap with a
 * transition library if they want enter/exit animations. Keeping the
 * panel itself transition-free keeps the bundle small and avoids
 * coupling to a specific animation primitive.
 */
export function CanvasPanel({
  open,
  onOpenChange,
  artifact,
  versions,
  onVersionSelect,
  renderers,
  onFork,
  hideActions,
  className,
  'aria-label': ariaLabel,
}: CanvasPanelProps) {
  const titleId = useRef(`canvas-panel-title-${Math.random().toString(36).slice(2, 10)}`).current
  const hidden = useMemo(() => new Set(hideActions ?? []), [hideActions])

  // Esc closes — bound only while the panel is open so closed panels
  // don't lurk in the document-level listener registry.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  // Pre-compute the serialized copy text so CopyButton can render even
  // when artifact is null (button is gated by conditional below).
  const copyText = useMemo(
    () => (artifact !== null ? serializeArtifactForCopy(artifact) : ''),
    [artifact],
  )

  const handleDownload = useCallback(async () => {
    if (artifact === null || typeof document === 'undefined') return
    const blob = await artifactToBlob(artifact)
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = filenameFor(artifact)
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [artifact])

  const handleFork = useCallback(() => {
    if (artifact !== null && onFork !== undefined) onFork(artifact)
  }, [artifact, onFork])

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange])

  if (!open) return null

  return (
    <aside
      role="complementary"
      aria-labelledby={titleId}
      aria-label={ariaLabel}
      data-testid="canvas-panel"
      data-state="open"
      className={[
        'flex h-full min-w-[320px] max-w-[720px] flex-col border-l border-border/60 bg-background',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-card/40 px-3 py-2">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="truncate text-sm font-semibold"
            data-testid="canvas-panel-title"
          >
            {artifact?.title ?? 'Canvas'}
          </h2>
          {artifact !== null ? (
            <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
              {artifact.kind} · v{artifact.version}
            </p>
          ) : null}
        </div>
        <CanvasToolbar
          artifact={artifact}
          copyText={copyText}
          hidden={hidden}
          onDownload={() => void handleDownload()}
          onFork={onFork !== undefined ? handleFork : undefined}
          onClose={handleClose}
        />
      </header>

      <CanvasArtifactList
        artifact={artifact}
        versions={versions}
        onVersionSelect={onVersionSelect}
        renderers={renderers}
      />
    </aside>
  )
}
