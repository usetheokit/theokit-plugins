import { Button, DropdownMenu } from '@theokit/ui'
import { useCallback, useMemo } from 'react'

import type { Artifact } from '../schema.js'
import {
  type ArtifactCandidate,
  type ExtractContext,
  extractArtifactCandidates,
} from './extract-artifacts.js'

export interface OpenInCanvasButtonProps {
  /** Raw text of the chat message to extract from. */
  messageContent: string
  /** Stable message id — used to build candidate artifact ids. */
  messageId: string
  /** Optional session id, threaded into the artifact envelope. */
  sessionId?: string
  /** Called with the chosen Artifact once the user picks a candidate. */
  onPublish: (artifact: Artifact) => void
  /** Override the button label. */
  label?: string
  /** Test seam — supply a custom extractor (e.g. richer GFM tables). */
  extractor?: (body: string, ctx: ExtractContext) => ArtifactCandidate[]
  className?: string
}

/**
 * `<OpenInCanvasButton>` — small chat-toolbar button that scans the
 * adjacent assistant message for candidate artifacts and exposes a
 * picker.
 *
 * UX:
 *   - exactly ONE candidate found → click publishes immediately
 *   - multiple candidates → click opens an inline picker; choosing
 *     publishes; clicking outside / Esc dismisses
 *   - zero candidates → button is rendered but disabled (still
 *     visible so the chat row doesn't reflow when an empty message
 *     becomes non-empty mid-stream)
 *
 * The button is keyboard accessible — picker rows are `<button>`s,
 * `aria-haspopup="menu"` is set on the trigger, and the menu carries
 * `role="menu"`.
 */
export function OpenInCanvasButton({
  messageContent,
  messageId,
  sessionId,
  onPublish,
  label = 'Open in canvas',
  extractor,
  className,
}: OpenInCanvasButtonProps) {
  const candidates = useMemo<ArtifactCandidate[]>(() => {
    const fn = extractor ?? extractArtifactCandidates
    return fn(messageContent, { messageId, sessionId })
  }, [messageContent, messageId, sessionId, extractor])

  const onPick = useCallback(
    (candidate: ArtifactCandidate) => {
      onPublish(candidate.build())
    },
    [onPublish],
  )

  const triggerDisabled = candidates.length === 0
  const wrapperClass = ['relative inline-block', className].filter(Boolean).join(' ')

  // 0 candidates → disabled button, no menu wrap.
  if (triggerDisabled) {
    return (
      <div className={wrapperClass}>
        <Button
          variant="secondary"
          size="sm"
          disabled
          data-testid={`open-in-canvas-${messageId}`}
          data-candidates={0}
        >
          <CanvasIcon />
          {label}
        </Button>
      </div>
    )
  }

  // 1 candidate → direct publish on click (no menu).
  if (candidates.length === 1) {
    const only = candidates[0]
    return (
      <div className={wrapperClass}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => only && onPublish(only.build())}
          data-testid={`open-in-canvas-${messageId}`}
          data-candidates={1}
        >
          <CanvasIcon />
          {label}
        </Button>
      </div>
    )
  }

  // 2+ candidates → DropdownMenu picker. Radix provides keyboard nav,
  // Esc-to-close, focus trap, and Portal-based positioning for free.
  return (
    <div className={wrapperClass}>
      <DropdownMenu>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="secondary"
            size="sm"
            data-testid={`open-in-canvas-${messageId}`}
            data-candidates={candidates.length}
          >
            <CanvasIcon />
            {label}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" data-testid="open-in-canvas-picker">
          {candidates.map((c) => (
            <DropdownMenu.Item
              key={c.id}
              data-testid={`open-in-canvas-pick-${c.id}`}
              onSelect={() => onPick(c)}
            >
              {c.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu>
    </div>
  )
}

function CanvasIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 14h6l2 -3l3 5l2 -2h5" />
    </svg>
  )
}
