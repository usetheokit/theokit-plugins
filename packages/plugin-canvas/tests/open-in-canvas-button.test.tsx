/**
 * @vitest-environment jsdom
 *
 * T4.5 — OpenInCanvasButton picker + dispatch.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OpenInCanvasButton } from '../src/ui/open-in-canvas-button.js'
import type { Artifact } from '../src/schema.js'

describe('OpenInCanvasButton', () => {
  it('one candidate → click publishes immediately (no picker)', () => {
    const onPublish = vi.fn<(artifact: Artifact) => void>()
    const code = '```ts\nconst x = 1\n```'
    render(<OpenInCanvasButton messageContent={code} messageId="msg-1" onPublish={onPublish} />)
    const trigger = screen.getByTestId('open-in-canvas-msg-1')
    expect(trigger.getAttribute('data-candidates')).toBe('1')
    fireEvent.click(trigger)
    expect(onPublish).toHaveBeenCalledOnce()
    expect(onPublish.mock.calls[0]?.[0].kind).toBe('code')
    expect(screen.queryByTestId('open-in-canvas-picker')).toBeNull()
  })

  it('multiple candidates → keyboard opens picker; choosing publishes (EC-5)', () => {
    const onPublish = vi.fn<(artifact: Artifact) => void>()
    render(
      <OpenInCanvasButton
        messageContent={'```ts\nA\n```\nintro\n```mermaid\ngraph TD; X-->Y\n```'}
        messageId="msg-2"
        onPublish={onPublish}
      />,
    )
    const trigger = screen.getByTestId('open-in-canvas-msg-2')
    expect(trigger.getAttribute('data-candidates')).toBe('2')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // EC-5: Radix DropdownMenu uses pointer/keyboard events, not synthetic clicks.
    // Open via keyboard (Enter on focused trigger) — works in jsdom.
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    fireEvent.click(items[1] as HTMLElement)
    expect(onPublish).toHaveBeenCalledOnce()
    expect(onPublish.mock.calls[0]?.[0].kind).toBe('mermaid')
  })

  it('zero candidates → button rendered but disabled', () => {
    const onPublish = vi.fn()
    render(<OpenInCanvasButton messageContent="   " messageId="msg-3" onPublish={onPublish} />)
    const trigger = screen.getByTestId('open-in-canvas-msg-3')
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(onPublish).not.toHaveBeenCalled()
  })

  it('custom extractor overrides the default detection', () => {
    const onPublish = vi.fn()
    render(
      <OpenInCanvasButton
        messageContent="anything"
        messageId="msg-4"
        onPublish={onPublish}
        extractor={() => [
          {
            id: 'forced',
            label: 'Forced markdown',
            build: () => ({
              kind: 'markdown',
              content: 'FORCED',
              id: 'forced',
              title: 'forced',
              version: 1,
              createdAt: '2026-05-29T00:00:00Z',
            }),
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByTestId('open-in-canvas-msg-4'))
    expect(onPublish.mock.calls[0]?.[0]).toMatchObject({
      kind: 'markdown',
      content: 'FORCED',
    })
  })
})
