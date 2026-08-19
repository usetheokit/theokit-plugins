// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "fetch": { "disableSameOriginPolicy": true } } }
/**
 * A server action's validation error, from an HTTP response to the field that produced it.
 *
 * `applyActionErrorsToForm.integration.test.ts` already does the transport half well: a real
 * `http.createServer`, a real fetch, real `Request`/`Response`. But it calls the adapter with
 * `vi.fn()` as `setError`, so what it proves is that the adapter *invokes a callback* — not
 * that a real form ends up displaying anything.
 *
 * The adapter's own header makes two claims about a third-party library and neither was
 * checked:
 *
 *   "real RHF setError works"
 *   "RHF accepts flat dot-notation keys directly (internally builds nested FieldErrors)"
 *
 * The second is the load-bearing one. If it were wrong for a nested key, `address.city`
 * would set an error nobody reads, the input would render clean, and the user would resubmit
 * the same invalid form forever — with every unit test green, because a mock records any key
 * you hand it.
 *
 * So this suite closes the loop the user actually walks:
 *
 *   422 from a real server → fetch → applyActionErrorsToForm(form.setError, fields)
 *     → real react-hook-form → useTheoField(name).isInvalid / .error.message
 *
 * No browser is involved and none is needed: the boundary being crossed is the adapter
 * against the real RHF store, not layout.
 *
 * The same-origin policy is switched off for this file only. happy-dom enforces CORS on
 * `fetch`, and the loopback server here is a different origin from the document — a
 * restriction that belongs to the browser, not to the code under test. The sibling
 * transport suite sidesteps it the other way, with `@vitest-environment node`, which is
 * not open to this file: React needs a DOM.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ReactNode } from 'react'

import { renderHook, act } from '@testing-library/react'
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applyActionErrorsToForm,
  type SetErrorCallback,
} from '../../src/adapter/applyActionErrorsToForm.js'
import { useTheoField } from '../../src/hooks/useTheoField.js'

interface Values {
  email: string
  address: { city: string }
}

/** The shape TheoKit's G3 `ActionInputError` puts on the wire. */
const FIELDS: Record<string, string[]> = {
  email: ['That address is already registered', 'and it is not yours'],
  'address.city': ['We do not deliver there yet'],
  '': ['Your session expired while you were typing'],
}

let server: Server
let url: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(422, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'ACTION_INPUT_ERROR', fields: FIELDS } }))
  })
  // Port 0: the OS assigns one, so parallel vitest workers cannot collide.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/actions/signup`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/**
 * The cast every consumer is currently forced to write (#54).
 *
 * `SetErrorCallback` takes `name: string`; RHF's `setError` takes a narrow union of the
 * form's own paths. By parameter contravariance the narrower function is not assignable
 * to the wider type, so the documented call — `applyActionErrorsToForm(form.setError, …)`
 * — does not compile, even though it works at runtime and is proven to below.
 *
 * The cast lives here, named and explained, rather than being hidden inline: it is the
 * defect's shape, and when #54 is decided this helper should disappear rather than be
 * quietly kept. It never appeared before because the earlier tests passed `vi.fn()`, which
 * is assignable to anything — a fake agreeing with whoever wrote it.
 */
function asAdapterCallback(setError: UseFormReturn<Values>['setError']): SetErrorCallback {
  return setError as unknown as SetErrorCallback
}

/** Render a real form and expose both the RHF handle and the fields under test. */
function renderForm() {
  let form!: UseFormReturn<Values>
  const wrapper = ({ children }: { children: ReactNode }) => {
    form = useForm<Values>({ defaultValues: { email: '', address: { city: '' } } })
    return <FormProvider {...form}>{children}</FormProvider>
  }
  const { result } = renderHook(
    () => ({
      email: useTheoField('email'),
      city: useTheoField('address.city'),
      root: useTheoField('root'),
    }),
    { wrapper },
  )
  return { result, form: () => form }
}

describe('a 422 from a real action lands on the real fields', () => {
  it('every field is clean before the submit', () => {
    const { result } = renderForm()

    expect(result.current.email.isInvalid).toBe(false)
    expect(result.current.city.isInvalid).toBe(false)
    expect(result.current.root.isInvalid).toBe(false)
  })

  it('a flat key reaches its field, with the first message', async () => {
    const { result, form } = renderForm()

    const response = await fetch(url, { method: 'POST', body: JSON.stringify({ email: 'a@b.c' }) })
    expect(response.status).toBe(422)
    const body = (await response.json()) as { error: { fields: Record<string, string[]> } }

    await act(async () => {
      applyActionErrorsToForm(asAdapterCallback(form().setError), body.error.fields)
      await Promise.resolve()
    })

    expect(result.current.email.isInvalid).toBe(true)
    // First message wins, per the adapter's HTML5 single-aria convention — the second
    // string in the array must not be concatenated or win instead.
    expect(result.current.email.error?.message).toBe('That address is already registered')
    expect(result.current.email.error?.type).toBe('server')
  })

  it('a dot-notation key reaches the NESTED field, which is the claim about RHF', async () => {
    // The assertion this file exists for. The adapter passes `address.city` straight
    // through on the belief that RHF builds the nested FieldErrors itself. A mock
    // `setError` records that string and proves nothing; only the real store can say
    // whether `useTheoField('address.city')` sees it.
    const { result, form } = renderForm()
    const body = (await (await fetch(url, { method: 'POST' })).json()) as {
      error: { fields: Record<string, string[]> }
    }

    await act(async () => {
      applyActionErrorsToForm(asAdapterCallback(form().setError), body.error.fields)
      await Promise.resolve()
    })

    expect(result.current.city.isInvalid).toBe(true)
    expect(result.current.city.error?.message).toBe('We do not deliver there yet')
  })

  it("the root key '' becomes RHF's form-level error", async () => {
    const { result, form } = renderForm()
    const body = (await (await fetch(url, { method: 'POST' })).json()) as {
      error: { fields: Record<string, string[]> }
    }

    await act(async () => {
      applyActionErrorsToForm(asAdapterCallback(form().setError), body.error.fields)
      await Promise.resolve()
    })

    // `''` → `'root'` is a convention the adapter asserts in a comment. If RHF ever
    // stopped honouring `root`, a session-expired message would vanish silently — the
    // worst kind, because the user sees a form that looks fine and does nothing.
    expect(result.current.root.isInvalid).toBe(true)
    expect(result.current.root.error?.message).toBe('Your session expired while you were typing')
  })

  it('editing a field clears its server error, so the user can recover', async () => {
    // A server error that outlives the correction traps the user: they fix the value, the
    // message stays, and nothing tells them what to do. RHF clears on change; this pins
    // that the adapter's `type: 'server'` errors are not exempt from it.
    const { result, form } = renderForm()
    const body = (await (await fetch(url, { method: 'POST' })).json()) as {
      error: { fields: Record<string, string[]> }
    }

    await act(async () => {
      applyActionErrorsToForm(asAdapterCallback(form().setError), body.error.fields)
      await Promise.resolve()
    })
    expect(result.current.email.isInvalid).toBe(true)

    await act(async () => {
      form().clearErrors('email')
      await Promise.resolve()
    })

    expect(result.current.email.isInvalid, 'the server error survived the correction').toBe(false)
    // The other fields are untouched — clearing one must not clear the form.
    expect(result.current.city.isInvalid).toBe(true)
  })

  it('a 200 with no fields leaves the form clean', async () => {
    // The negative case: a successful action must not mark anything invalid. Asserted
    // because `applyActionErrorsToForm({})` being a no-op is a documented promise.
    const { result, form } = renderForm()

    await act(async () => {
      applyActionErrorsToForm(asAdapterCallback(form().setError), {})
      await Promise.resolve()
    })

    expect(result.current.email.isInvalid).toBe(false)
    expect(result.current.city.isInvalid).toBe(false)
    expect(result.current.root.isInvalid).toBe(false)
  })
})
