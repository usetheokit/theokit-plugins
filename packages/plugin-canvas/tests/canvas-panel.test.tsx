/**
 * @vitest-environment jsdom
 *
 * T4.4 — CanvasPanel + ArtifactVersionRail tests. Covers:
 *   - controlled open/close (incl. Esc keyboard)
 *   - rendering ArtifactRenderer in the body
 *   - toolbar actions (copy via clipboard mock; download via blob URL
 *     mock; fork dispatched on click)
 *   - ArtifactVersionRail visibility threshold + click dispatch
 *   - aria semantics (role, aria-labelledby)
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasPanel } from '../src/ui/canvas-panel.js'
import { ArtifactVersionRail } from '../src/ui/artifact-version-rail.js'
import type { Artifact } from '../src/schema.js'

const env = {
  id: 'art-1',
  title: 'My drawing',
  version: 1,
  createdAt: '2026-05-29T00:00:00Z',
}

const md: Artifact = { ...env, kind: 'markdown', content: '# hello' }
const code: Artifact = { ...env, kind: 'code', language: 'ts', content: 'const x = 1' }

let writeText: ReturnType<typeof vi.fn>
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve(undefined))
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  createObjectURL = vi.fn(() => 'blob:mock://1')
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CanvasPanel — open / close behaviour', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <CanvasPanel open={false} onOpenChange={() => undefined} artifact={md} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the panel + ArtifactRenderer when open', () => {
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={md} />)
    expect(screen.getByTestId('canvas-panel')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-renderer')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-panel-title')).toHaveTextContent('My drawing')
  })

  it('shows empty placeholder when artifact=null', () => {
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={null} />)
    expect(screen.getByTestId('canvas-panel-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('artifact-renderer')).toBeNull()
  })

  it('Close button calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn()
    render(<CanvasPanel open onOpenChange={onOpenChange} artifact={md} />)
    fireEvent.click(screen.getByTestId('canvas-toolbar-close'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Esc keydown closes', () => {
    const onOpenChange = vi.fn()
    render(<CanvasPanel open onOpenChange={onOpenChange} artifact={md} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Esc listener is unbound after close (no leak)', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(<CanvasPanel open onOpenChange={onOpenChange} artifact={md} />)
    rerender(<CanvasPanel open={false} onOpenChange={onOpenChange} artifact={md} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('CanvasPanel — toolbar actions', () => {
  it('Copy button invokes navigator.clipboard.writeText with serialised content', () => {
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={code} />)
    fireEvent.click(screen.getByTestId('canvas-toolbar-copy'))
    expect(writeText).toHaveBeenCalledWith('const x = 1')
  })

  it('Download button creates a blob URL + revokes it', async () => {
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={code} />)
    fireEvent.click(screen.getByTestId('canvas-toolbar-download'))
    // microtasks: artifactToBlob is async
    await Promise.resolve()
    await Promise.resolve()
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock://1')
  })

  it('Fork button hidden when onFork is undefined', () => {
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={md} />)
    expect(screen.queryByTestId('canvas-toolbar-fork')).toBeNull()
  })

  it('Fork button visible + dispatches when onFork provided', () => {
    const onFork = vi.fn()
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={md} onFork={onFork} />)
    fireEvent.click(screen.getByTestId('canvas-toolbar-fork'))
    expect(onFork).toHaveBeenCalledWith(md)
  })

  it('hideActions hides individual buttons', () => {
    render(
      <CanvasPanel
        open
        onOpenChange={() => undefined}
        artifact={md}
        hideActions={['copy', 'download']}
      />,
    )
    expect(screen.queryByTestId('canvas-toolbar-copy')).toBeNull()
    expect(screen.queryByTestId('canvas-toolbar-download')).toBeNull()
    expect(screen.getByTestId('canvas-toolbar-close')).toBeInTheDocument()
  })

  // EC-8 (canvas-ecosystem-refactor): Tooltip wraps Button via asChild ref forwarding.
  // Regression test that click handlers still fire when the button is wrapped.
  it('Close button fires onOpenChange even when wrapped by Tooltip (EC-8)', () => {
    const onOpenChange = vi.fn()
    render(<CanvasPanel open onOpenChange={onOpenChange} artifact={md} />)
    fireEvent.click(screen.getByTestId('canvas-toolbar-close'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Download button fires inside Tooltip wrapper (EC-8)', async () => {
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={code} />)
    fireEvent.click(screen.getByTestId('canvas-toolbar-download'))
    await Promise.resolve()
    await Promise.resolve()
    expect(createObjectURL).toHaveBeenCalled()
  })
})

describe('CanvasPanel — a11y', () => {
  it('root has role="complementary" + aria-labelledby pointing to the title', () => {
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={md} />)
    const root = screen.getByTestId('canvas-panel')
    expect(root.getAttribute('role')).toBe('complementary')
    const labelledBy = root.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    expect(document.getElementById(labelledBy ?? '')).toHaveTextContent('My drawing')
  })

  it('shows kind + version in the header', () => {
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={{ ...code, version: 3 }} />)
    expect(screen.getByTestId('canvas-panel')).toHaveTextContent('code')
    expect(screen.getByTestId('canvas-panel')).toHaveTextContent('v3')
  })
})

describe('ArtifactVersionRail', () => {
  const v1: Artifact = { ...env, version: 1, kind: 'markdown', content: 'a' }
  const v2: Artifact = { ...env, version: 2, kind: 'markdown', content: 'b' }
  const v3: Artifact = { ...env, version: 3, kind: 'markdown', content: 'c' }

  it('renders nothing when only one version', () => {
    const { container } = render(
      <ArtifactVersionRail versions={[v1]} currentVersion={1} onSelect={() => undefined} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders pills for every version', () => {
    render(
      <ArtifactVersionRail versions={[v1, v2, v3]} currentVersion={3} onSelect={() => undefined} />,
    )
    expect(screen.getByTestId('version-pill-1')).toBeInTheDocument()
    expect(screen.getByTestId('version-pill-2')).toBeInTheDocument()
    expect(screen.getByTestId('version-pill-3')).toBeInTheDocument()
  })

  it('marks the current version with aria-current + data-active', () => {
    render(
      <ArtifactVersionRail versions={[v1, v2, v3]} currentVersion={2} onSelect={() => undefined} />,
    )
    const current = screen.getByTestId('version-pill-2')
    expect(current.getAttribute('aria-current')).toBe('true')
    expect(current.getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('version-pill-1').getAttribute('aria-current')).toBeNull()
  })

  it('click dispatches onSelect with the chosen artifact', () => {
    const onSelect = vi.fn()
    render(<ArtifactVersionRail versions={[v1, v2]} currentVersion={2} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('version-pill-1'))
    expect(onSelect).toHaveBeenCalledWith(v1)
  })
})

describe('CanvasPanel — version rail integration', () => {
  it('renders the rail when 2+ versions provided', () => {
    const v1: Artifact = { ...env, version: 1, kind: 'markdown', content: 'a' }
    const v2: Artifact = { ...env, version: 2, kind: 'markdown', content: 'b' }
    render(<CanvasPanel open onOpenChange={() => undefined} artifact={v2} versions={[v1, v2]} />)
    expect(screen.getByTestId('artifact-version-rail')).toBeInTheDocument()
  })

  it('clicking a pill calls onVersionSelect with that version', () => {
    const v1: Artifact = { ...env, version: 1, kind: 'markdown', content: 'a' }
    const v2: Artifact = { ...env, version: 2, kind: 'markdown', content: 'b' }
    const onVersionSelect = vi.fn()
    render(
      <CanvasPanel
        open
        onOpenChange={() => undefined}
        artifact={v2}
        versions={[v1, v2]}
        onVersionSelect={onVersionSelect}
      />,
    )
    fireEvent.click(screen.getByTestId('version-pill-1'))
    expect(onVersionSelect).toHaveBeenCalledWith(v1)
  })
})
