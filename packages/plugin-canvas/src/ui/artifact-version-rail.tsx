import { Button } from '@usetheo/ui'

import type { Artifact } from '../schema.js'

export interface ArtifactVersionRailProps {
  /**
   * All versions of the artifact ordered ascending by `version`. The
   * rail itself does not sort — caller must pass a stable order so
   * scroll positions don't jump on update.
   */
  versions: readonly Artifact[]
  /** The currently selected version (typically the highest one). */
  currentVersion: number
  /** Click handler — passes the chosen artifact, not the index. */
  onSelect: (artifact: Artifact) => void
  className?: string
}

/**
 * Vertical rail of version pills. Renders nothing when only one
 * version exists — we don't add chrome the user can't interact with.
 *
 * A11y: rendered as a `nav` with `aria-label="Artifact versions"`;
 * each pill is a real `<button>` so keyboard / SR users can navigate
 * with Tab + Enter / Space without any custom key handling.
 */
export function ArtifactVersionRail({
  versions,
  currentVersion,
  onSelect,
  className,
}: ArtifactVersionRailProps) {
  if (versions.length <= 1) return null
  return (
    <nav
      aria-label="Artifact versions"
      data-testid="artifact-version-rail"
      className={[
        'flex shrink-0 flex-col items-stretch gap-1 border-l border-border/40 bg-muted/30 p-2',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {versions.map((v) => {
        const active = v.version === currentVersion
        return (
          <Button
            key={`${v.id}-${v.version}`}
            variant={active ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onSelect(v)}
            aria-current={active ? 'true' : undefined}
            aria-pressed={active}
            data-testid={`version-pill-${v.version}`}
            data-active={active ? 'true' : undefined}
            className="justify-start font-mono text-[0.7rem]"
          >
            v{v.version}
          </Button>
        )
      })}
    </nav>
  )
}
