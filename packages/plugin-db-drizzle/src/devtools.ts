/**
 * @theokit/plugin-db-drizzle — devtools-tab descriptor.
 *
 * Per plan p5-plugin-db-drizzle v1.0 § Phase 2 / T2.2. Blueprint ADR D2:
 * studio is passthrough; when G4 devtools overlay is detected, the plugin
 * registers an IFRAMEs-the-studio tab for visual continuity.
 *
 * Graceful no-op when overlay absent (consumer's plugin runner does NOT
 * call `app.registerDevtoolsTab` when the overlay package is missing).
 */

import type { ResolvedDrizzleDbOptions } from './options.js'

/** Descriptor shape consumed by theokit's devtools overlay (G4). */
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
