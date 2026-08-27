/**
 * usetheokit/theokit-plugins#175 — a server field error carried in the `{ data, error }` envelope
 * must land on the input, not surface as an unhandled rejection.
 *
 * The package's headline is "server field errors landing on the right input". It worked over HTTP
 * and failed for a LOCAL action, and the difference is the transport: HTTP unwraps the envelope
 * before the adapter sees it, so `fields` arrived flat. A local action resolves with the envelope
 * intact, `extractFieldsFromError` found no `fields` at the top level, and `routeActionError`
 * re-threw — no banner, no inline message, nothing on screen.
 */
import { describe, expect, it, vi } from 'vitest'

import { extractFieldsFromError, routeActionError } from '../../src/components/TheoForm.js'

const FIELDS = { email: ['That address is already registered'] }

describe('#175 — the fields map is found in both shapes', () => {
  it('reads the flat shape the HTTP path produces', () => {
    expect(extractFieldsFromError({ code: 'ACTION_INPUT_ERROR', fields: FIELDS })).toEqual(FIELDS)
  })

  it('reads the envelope a local action resolves with', () => {
    // The exact shape from the issue: the action returns `{ data, error }` per its declared type.
    expect(
      extractFieldsFromError({
        data: undefined,
        error: { code: 'ACTION_INPUT_ERROR', message: 'the server refused one field', fields: FIELDS },
      }),
    ).toEqual(FIELDS)
  })

  it('still returns undefined for an error that carries no fields at either level', () => {
    // The `throw err` branch must survive: an arbitrary failure is not a validation error and
    // swallowing it here would trade a visible defect for a silent one.
    expect(extractFieldsFromError(new Error('network down'))).toBeUndefined()
    expect(extractFieldsFromError({ error: { code: 'BOOM' } })).toBeUndefined()
    expect(extractFieldsFromError(null)).toBeUndefined()
  })

  it('routes the envelope onto the form instead of re-throwing', () => {
    const setError = vi.fn()
    const envelope = {
      data: undefined,
      error: { code: 'ACTION_INPUT_ERROR', message: 'refused', fields: FIELDS },
    }

    expect(() => {
      routeActionError(envelope, setError)
    }).not.toThrow()
    expect(setError).toHaveBeenCalledWith('email', {
      type: 'server',
      message: 'That address is already registered',
    })
  })

  it('an unrecognised error is still re-thrown', () => {
    const boom = new Error('network down')
    expect(() => {
      routeActionError(boom, vi.fn())
    }).toThrow(boom)
  })
})
