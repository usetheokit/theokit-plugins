/**
 * Phase 2 / T2.1 — adapter unit tests per plan p4-plugin-forms v1.1.
 *
 * Strategy: tests are pure-function (no React/RHF runtime). The adapter
 * accepts a `setError` callback (signature compatible with RHF's `UseFormSetError`)
 * and an `ActionInputError.fields` map (`Record<string, string[]>` with dot-notation
 * full-path keys, root → ''). We spy on the callback to assert correct
 * invocation pattern; this verifies the adapter's contract without
 * needing a real React tree (RHF integration validated in Phase 4 component tests).
 */
import { describe, expect, it, vi } from 'vitest'
import { applyActionErrorsToForm } from '../../src/adapter/applyActionErrorsToForm.js'

describe('applyActionErrorsToForm', () => {
  it("maps a flat key to setError with type 'server'", () => {
    const setError = vi.fn()
    applyActionErrorsToForm(setError, { name: ['Required'] })
    expect(setError).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith('name', { type: 'server', message: 'Required' })
  })

  it('maps nested dot-notation key unchanged (RHF supports it natively)', () => {
    const setError = vi.fn()
    applyActionErrorsToForm(setError, { 'user.address.zip': ['Invalid ZIP'] })
    expect(setError).toHaveBeenCalledWith('user.address.zip', {
      type: 'server',
      message: 'Invalid ZIP',
    })
  })

  it('maps array-index segment unchanged (RHF supports items.0.qty form)', () => {
    const setError = vi.fn()
    applyActionErrorsToForm(setError, { 'items.0.qty': ['Must be >= 1'] })
    expect(setError).toHaveBeenCalledWith('items.0.qty', {
      type: 'server',
      message: 'Must be >= 1',
    })
  })

  it("maps root key '' to 'root' per RHF convention", () => {
    const setError = vi.fn()
    applyActionErrorsToForm(setError, { '': ['Form-level error'] })
    expect(setError).toHaveBeenCalledWith('root', { type: 'server', message: 'Form-level error' })
  })

  it('dispatches setError once per key when multiple keys present', () => {
    const setError = vi.fn()
    applyActionErrorsToForm(setError, {
      a: ['A error'],
      b: ['B error'],
      'c.d': ['C.D error'],
    })
    expect(setError).toHaveBeenCalledTimes(3)
    expect(setError).toHaveBeenCalledWith('a', { type: 'server', message: 'A error' })
    expect(setError).toHaveBeenCalledWith('b', { type: 'server', message: 'B error' })
    expect(setError).toHaveBeenCalledWith('c.d', { type: 'server', message: 'C.D error' })
  })

  it('is a no-op when fields is empty', () => {
    const setError = vi.fn()
    applyActionErrorsToForm(setError, {})
    expect(setError).not.toHaveBeenCalled()
  })

  it('uses the first message when a field has multiple messages (HTML5 single-aria convention)', () => {
    const setError = vi.fn()
    applyActionErrorsToForm(setError, { x: ['First message', 'Second message', 'Third'] })
    expect(setError).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith('x', { type: 'server', message: 'First message' })
  })

  it('skips keys with empty messages array (defensive — should not occur from G3 but guards data shape)', () => {
    const setError = vi.fn()
    applyActionErrorsToForm(setError, { x: [] })
    expect(setError).not.toHaveBeenCalled()
  })
})
