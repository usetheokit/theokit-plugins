/**
 * @vitest-environment jsdom
 *
 * T1.3 (#177) — the mermaid renderer MUST run the mermaid-produced SVG through
 * `sanitizeSvg` before `dangerouslySetInnerHTML`. `securityLevel:'strict'` has
 * documented XSS bypasses, so the render-time sanitize is defense-in-depth.
 *
 * This lives in its own file so `vi.mock('mermaid')` (and the module-level
 * `pending` memo inside loadMermaid) stay isolated from artifact-renderer.test.tsx,
 * whose existing mermaid case relies on the real `import('mermaid')` failing in
 * jsdom to exercise the fallback path.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    // Simulate a mermaid render that emits a script-bearing SVG (the
    // securityLevel:'strict' bypass scenario the finding guards against).
    render: vi.fn(() =>
      Promise.resolve({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>',
      }),
    ),
  },
}))

import { MermaidArtifact } from '../src/ui/renderers/mermaid-artifact.js'
import type { Artifact } from '../src/schema.js'

type MermaidArt = Extract<Artifact, { kind: 'mermaid' }>

const mermaidArtifact = {
  id: 'm1',
  title: 'T',
  version: 1,
  createdAt: '2026-05-29T00:00:00Z',
  kind: 'mermaid',
  content: 'graph TD; A-->B',
} as MermaidArt

describe('MermaidArtifact (#177) — sanitizes the rendered SVG', () => {
  it('strips <script> from the mermaid-rendered SVG before injecting it into the DOM', async () => {
    render(<MermaidArtifact artifact={mermaidArtifact} />)
    await waitFor(() =>
      expect(screen.getByTestId('mermaid-artifact').getAttribute('data-state')).toBe('ready'),
    )
    const el = screen.getByTestId('mermaid-artifact')
    // jsdom never EXECUTES innerHTML scripts — assert the script NODE is absent
    // (the only assertion that fails on unsanitized output, passes after sanitize).
    expect(el.querySelector('script')).toBeNull()
    expect(el.innerHTML).not.toMatch(/<script/i)
    // benign markup survives — guards against over-stripping.
    expect(el.innerHTML).toMatch(/<rect/i)
  })
})
