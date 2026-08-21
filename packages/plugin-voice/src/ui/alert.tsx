/**
 * Self-contained Alert primitive used by `<VoiceRecorderBar>` to surface
 * permission / device / upstream errors without forcing a peer dep on
 * `@theokit/ui`. Apps that already render a design-system Alert can
 * pass their own via the `renderError` prop on the recorder bar.
 *
 * The `kind` prop maps to a `data-state` attribute so consumers can
 * style each variant via Tailwind / vanilla CSS without changing the
 * component's API.
 *
 * Accessibility:
 *   - `role="alert"` so screen readers announce the message as it
 *     appears (no need to manage focus manually).
 *   - `aria-live="polite"` defers the announcement to the next idle
 *     point — appropriate for non-critical UX (the user can read it).
 */
import type { ReactNode } from 'react'
import { AlertIcon } from './icons.js'

/**
 * Why voice failed, in the terms a user can act on.
 *
 * The split is by remedy, not by error class: `'auth'` means grant permission, `'device'` means no
 * usable microphone, `'upstream'` means retry later. `'generic'` is the honest fallback rather than
 * guessing wrong and telling someone to fix the wrong thing.
 */
export type AlertKind = 'auth' | 'device' | 'upstream' | 'generic'

/** Props for `<VoiceAlert>`. `kind` selects the standing explanation; `title` is the specific one. */
export interface VoiceAlertProps {
  kind: AlertKind
  title: string
  children?: ReactNode
  className?: string
}

const KIND_LABEL: Record<AlertKind, string> = {
  auth: 'Microphone permission required',
  device: 'Microphone unavailable',
  upstream: 'Voice service error',
  generic: 'Voice error',
}

/**
 * Render a voice failure the user can act on.
 *
 * Carries `role="alert"` and `aria-live="polite"`, so a failure in a flow the user is driving by
 * voice is announced rather than only shown — the one case where the person may not be looking.
 */
export function VoiceAlert({ kind, title, children, className }: VoiceAlertProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      data-state="error"
      data-kind={kind}
      data-testid="voice-alert"
      className={[
        'flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children !== undefined && children !== null ? (
          <p className="mt-0.5 text-[0.7rem] leading-tight opacity-90">{children}</p>
        ) : null}
        <p className="sr-only">{KIND_LABEL[kind]}</p>
      </div>
    </div>
  )
}
