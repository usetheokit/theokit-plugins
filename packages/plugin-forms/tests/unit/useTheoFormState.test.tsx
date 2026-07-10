/**
 * Phase 3 / T3.1 — useTheoFormState Context tests per plan p4-plugin-forms v1.1.
 */
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  TheoFormContext,
  type TheoFormContextValue,
  useTheoFormState,
} from '../../src/context/TheoFormContext.js'

const FAKE_VALUE: TheoFormContextValue = {
  isPending: false,
  isSuccess: true,
  isError: false,
  error: undefined,
  data: { id: 42 },
  reset: () => {
    /* intentionally empty — test fixture: reset behavior is exercised elsewhere */
  },
}

describe('useTheoFormState', () => {
  it('returns the Context value when wrapped in TheoFormContext.Provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TheoFormContext.Provider value={FAKE_VALUE}>{children}</TheoFormContext.Provider>
    )
    const { result } = renderHook(() => useTheoFormState(), { wrapper })
    expect(result.current).toBe(FAKE_VALUE)
    expect(result.current.data).toEqual({ id: 42 })
    expect(result.current.isSuccess).toBe(true)
  })

  it('throws actionable error when used outside <TheoForm>', () => {
    // renderHook captures the error rather than letting it bubble; assert via try/catch
    let caught: unknown = null
    try {
      renderHook(() => useTheoFormState())
    } catch (err) {
      caught = err
    }
    // Either thrown sync (older RTL) or surfaced in result.error (newer RTL).
    // Both paths satisfy "errored out" — we just need actionable message somewhere.
    const message =
      caught instanceof Error
        ? caught.message
        : (() => {
            const { result } = renderHook(() => {
              try {
                return useTheoFormState()
              } catch (e) {
                return (e as Error).message
              }
            })
            return result.current as string
          })()
    expect(message).toMatch(/useTheoFormState/)
    expect(message).toMatch(/<TheoForm/)
  })
})
