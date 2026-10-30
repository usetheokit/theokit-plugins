/**
 * @theokit/plugin-db-drizzle — devtools-tab descriptor.
 *
 * A tab that frames drizzle-kit studio. Nothing here registers it: TheoKit has
 * no devtools-tab hook a plugin can call (#43), so the consumer mounts it in an
 * overlay of their own.
 */

import type { ResolvedDrizzleDbOptions } from './options.js'

/** A tab descriptor for the consumer's own devtools overlay. */
export interface DrizzleDevtoolsTab {
  readonly id: 'db-studio'
  readonly label: 'Database'
  /** Suggested IFRAME URL pointing at drizzle-kit studio. */
  readonly studioUrl: string
  /**
   * Mount the tab content into a host container. Builds an IFRAME pointing
   * at `studioUrl`. The overlay decides when to call this (e.g., when the
   * tab becomes visible).
   */
  mount: (container: HTMLElement) => void
}

/**
 * Build the devtools-tab descriptor from resolved plugin options.
 * Returns a fresh descriptor each call so each consumer site gets an
 * independent mount() closure.
 */
export function buildDevtoolsTab(opts: ResolvedDrizzleDbOptions): DrizzleDevtoolsTab {
  // Build the studio URL from the resolved host/port (default
  // localhost:4983) instead of a hardcoded constant.
  const studioUrl = `http://${opts.studioHost}:${opts.studioPort}`
  return {
    id: 'db-studio',
    label: 'Database',
    studioUrl,
    mount(container: HTMLElement): void {
      const iframe = container.ownerDocument.createElement('iframe')
      iframe.src = studioUrl
      // Do NOT pair `allow-scripts` with `allow-same-origin` — that lets
      // the framed studio remove its own sandbox and escape. Studio is a
      // separate origin (its own host:port), so same-origin is unnecessary.
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.style.border = '0'
      iframe.style.width = '100%'
      iframe.style.height = '100%'
      iframe.title = 'Drizzle Studio'
      container.replaceChildren(iframe)
    },
  }
}
