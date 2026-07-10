/**
 * @vitest-environment jsdom
 *
 * Tests for `<TalkOptions>` — controlled selector for TTS voice/speed.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  TALK_OPTION_SPEEDS,
  TALK_OPTION_VOICES,
  TalkOptions,
  type TalkOptionsValue,
} from '../src/ui/talk-options.js'

describe('T3.4 — TalkOptions', () => {
  it('renders voice + speed selects with current value selected', () => {
    const value: TalkOptionsValue = { voice: 'nova', speed: 1.25 }
    render(<TalkOptions value={value} onChange={() => undefined} />)
    const voice = screen.getByTestId('talk-options-voice')
    const speed = screen.getByTestId('talk-options-speed')
    expect(voice.value).toBe('nova')
    expect(speed.value).toBe('1.25')
  })

  it('exposes all six OpenAI tts-1 voices in the dropdown', () => {
    const value: TalkOptionsValue = { voice: 'alloy', speed: 1 }
    render(<TalkOptions value={value} onChange={() => undefined} />)
    const voice = screen.getByTestId<HTMLSelectElement>('talk-options-voice')
    const optionValues = Array.from(voice.options).map((o) => o.value)
    expect(optionValues).toEqual([...TALK_OPTION_VOICES])
  })

  it('exposes the four canonical speed multipliers', () => {
    const value: TalkOptionsValue = { voice: 'alloy', speed: 1 }
    render(<TalkOptions value={value} onChange={() => undefined} />)
    const speed = screen.getByTestId<HTMLSelectElement>('talk-options-speed')
    const optionValues = Array.from(speed.options).map((o) => Number(o.value))
    expect(optionValues).toEqual([...TALK_OPTION_SPEEDS])
  })

  it('fires onChange with the new voice (preserving speed)', () => {
    const value: TalkOptionsValue = { voice: 'alloy', speed: 1.25 }
    const onChange = vi.fn()
    render(<TalkOptions value={value} onChange={onChange} />)
    const voice = screen.getByTestId('talk-options-voice')
    fireEvent.change(voice, { target: { value: 'shimmer' } })
    expect(onChange).toHaveBeenCalledWith({ voice: 'shimmer', speed: 1.25 })
  })

  it('fires onChange with the new speed parsed as number (preserving voice)', () => {
    const value: TalkOptionsValue = { voice: 'nova', speed: 1 }
    const onChange = vi.fn()
    render(<TalkOptions value={value} onChange={onChange} />)
    const speed = screen.getByTestId('talk-options-speed')
    fireEvent.change(speed, { target: { value: '1.5' } })
    expect(onChange).toHaveBeenCalledWith({ voice: 'nova', speed: 1.5 })
  })

  it('hideSpeed prop omits the speed control', () => {
    const value: TalkOptionsValue = { voice: 'alloy', speed: 1 }
    render(<TalkOptions value={value} onChange={() => undefined} hideSpeed />)
    expect(screen.queryByTestId('talk-options-speed')).toBeNull()
    expect(screen.queryByTestId('talk-options-voice')).not.toBeNull()
  })
})
