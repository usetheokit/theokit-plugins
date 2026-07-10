/**
 * #227 — TheoForm error-routing regression test.
 *
 * Previously this test DUPLICATED the catch-block logic (a private copy of
 * `extractFieldsFromError` + a hand-written `simulateHandleValidCatch`), so it
 * could pass even if the real component diverged. It now imports the SINGLE
 * SOURCE the component itself uses — `routeActionError` / `extractFieldsFromError`
 * exported from `TheoForm.tsx` — and asserts the real routing: ActionInputError
 * `fields` → RHF `setError`; any other error → re-thrown (fail-fast).
 */
import { describe, expect, it, vi } from 'vitest'

import { extractFieldsFromError, routeActionError } from '../../src/components/TheoForm.js'

describe('TheoForm error routing (#227) — real source, no duplicated logic', () => {
  it('test_theoform_routes_field_errors_and_rethrows', () => {
    // Field error (ActionInputError shape) → routed to setError, NOT re-thrown.
    const setError = vi.fn()
    const actionError = {
      type: 'TheoActionInputError',
      code: 'VALIDATION_ERROR',
      status: 422,
      fields: { email: ['Required'] },
    }
    expect(() => routeActionError(actionError, setError)).not.toThrow()
    expect(setError).toHaveBeenCalledWith('email', expect.objectContaining({ message: 'Required' }))

    // Non-field error (TypeError) → re-thrown, NOT swallowed; setError untouched.
    const setError2 = vi.fn()
    const boom = new TypeError('onSuccess blew up')
    expect(() => routeActionError(boom, setError2)).toThrow(/onSuccess blew up/)
    expect(setError2).not.toHaveBeenCalled()
  })

  it('extractFieldsFromError recognizes ActionInputError shape, rejects others', () => {
    expect(extractFieldsFromError({ fields: { email: ['Required'] } })).toEqual({
      email: ['Required'],
    })
    expect(extractFieldsFromError(new TypeError('x'))).toBeUndefined()
    expect(extractFieldsFromError(null)).toBeUndefined()
    expect(extractFieldsFromError({ fields: null })).toBeUndefined()
  })
})
