/**
 * `<TheoForm>` as a consumer mounts it.
 *
 * The existing `TheoForm.test.tsx` covers `routeActionError` and `extractFieldsFromError` — the
 * pure functions extracted from the catch block — and covers them well. What nothing covered was
 * the component: lines 102-150, which is every line of it. `useAction`, the resolver choice, the
 * submit path, the composed `reset`, and the `<form>` element itself were unexecuted.
 *
 * That gap matters beyond a number. `routeActionError` being correct proves nothing about
 * whether the component CALLS it, with the real `setError`, on a real rejection — and #227, the
 * defect that function exists for, was exactly a wiring bug rather than a logic bug.
 *
 * These tests drive the component: real react-hook-form, real `useAction`, real submit events.
 * The action is a plain callable because that is all `useAction` takes — no provider, no mock of
 * our own code.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FormField } from '@usetheo/ui'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import {
  TheoField,
  useTheoFieldRegister,
  useTheoFieldScope,
} from '../../src/components/TheoField.js'
import { TheoForm, type TheoFormAction } from '../../src/components/TheoForm.js'
import { useTheoFormState } from '../../src/context/TheoFormContext.js'

interface Values {
  email: string
}

/**
 * The shape `TheoForm` expects: a callable, optionally carrying a schema by convention.
 *
 * Typed as the real `TheoFormAction` rather than as a loose function on purpose. The contract
 * says the action RESOLVES to `{ data, error }` and signals failure by rejecting — writing the
 * helper against that type is what keeps these tests describing the documented action shape
 * instead of whatever `useAction` happens to tolerate.
 */
function actionOf(
  impl: (input: Values) => Promise<unknown>,
  schema?: TheoFormAction<Values>['__zodSchema'],
): TheoFormAction<Values> {
  const call = impl as unknown as TheoFormAction<Values>
  return Object.assign(call, schema === undefined ? {} : { __zodSchema: schema })
}

function Control(): React.JSX.Element {
  const register = useTheoFieldRegister()
  return (
    <FormField.Control>
      <input {...register} />
    </FormField.Control>
  )
}

/**
 * `FormField.Error` renders its children and reads nothing on its own, so left self-closing it
 * shows an empty alert and the server's reason is dropped (#106). This is the composition the
 * README documents now, and the suite below is what would notice if it regressed.
 */
function FieldError(): React.JSX.Element {
  const { error } = useTheoFieldScope()
  return <FormField.Error>{error?.message}</FormField.Error>
}

function Body(): React.JSX.Element {
  return (
    <>
      <TheoField name="email">
        <FormField.Label>Email</FormField.Label>
        <Control />
        <FieldError />
      </TheoField>
      <button type="submit">Send</button>
    </>
  )
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('<TheoForm> element contract', () => {
  it('renders a real form that would submit without JavaScript', () => {
    // The progressive-enhancement half: method and encType are what a browser uses when the
    // handler never runs. A div with an onClick would satisfy every other test in this file.
    const { container } = render(
      <TheoForm action={actionOf(() => Promise.resolve({}))} defaultValues={{ email: '' }}>
        <Body />
      </TheoForm>,
    )

    const form = container.querySelector('form')
    expect(form?.getAttribute('method')).toBe('post')
    expect(form?.getAttribute('enctype')).toBe('application/x-www-form-urlencoded')
  })

  it('passes className through to the form element', () => {
    const { container } = render(
      <TheoForm
        action={actionOf(() => Promise.resolve({}))}
        defaultValues={{ email: '' }}
        className="stack"
      >
        <Body />
      </TheoForm>,
    )

    expect(container.querySelector('form')?.getAttribute('class')).toBe('stack')
  })
})

describe('<TheoForm> submit', () => {
  it('calls the action with the form values and hands the result to onSuccess', async () => {
    const action = vi.fn().mockResolvedValue({ id: 7 })
    const onSuccess = vi.fn()

    render(
      <TheoForm
        action={actionOf(action)}
        defaultValues={{ email: 'a@b.test' }}
        onSuccess={onSuccess}
      >
        <Body />
      </TheoForm>,
    )
    submit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 7 }))
    expect(action).toHaveBeenCalledWith({ email: 'a@b.test' })
  })

  it('routes a server field error onto the field that produced it', async () => {
    // The end-to-end version of #227: not "routeActionError does the right thing", but "the
    // component calls it, with the real setError, and the message reaches the DOM".
    const action = vi.fn().mockRejectedValue({
      type: 'TheoActionInputError',
      code: 'VALIDATION_ERROR',
      status: 422,
      fields: { email: ['Email is already taken'] },
    })

    render(
      <TheoForm action={actionOf(action)} defaultValues={{ email: 'a@b.test' }}>
        <Body />
      </TheoForm>,
    )
    submit()

    await waitFor(() => expect(screen.getByText('Email is already taken')).toBeTruthy())
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true')
  })

  it('does not reach the action when the resolver rejects the values', async () => {
    // With a schema, invalid input must never leave the browser. A form that posts anyway and
    // relies on the server to refuse is a different, slower product.
    const action = vi.fn().mockResolvedValue({})

    render(
      <TheoForm
        action={actionOf(
          action,
          z.object({
            email: z.string().email(),
          }) as unknown as TheoFormAction<Values>['__zodSchema'],
        )}
        defaultValues={{ email: 'not-an-email' }}
      >
        <Body />
      </TheoForm>,
    )
    submit()

    await waitFor(() =>
      expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true'),
    )
    expect(action, 'invalid values must not be sent').not.toHaveBeenCalled()
  })

  it('prefers an explicit schema prop over the one attached to the action', async () => {
    // Documented priority: `schema` > `action.__zodSchema` > none. Only observable when the two
    // disagree, so they are made to disagree: the action's schema would accept this value.
    const action = vi.fn().mockResolvedValue({})

    render(
      <TheoForm
        action={actionOf(
          action,
          z.object({ email: z.string() }) as unknown as TheoFormAction<Values>['__zodSchema'],
        )}
        schema={
          z.object({
            email: z.string().email(),
          }) as unknown as TheoFormAction<Values>['__zodSchema']
        }
        defaultValues={{ email: 'not-an-email' }}
      >
        <Body />
      </TheoForm>,
    )
    submit()

    await waitFor(() =>
      expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true'),
    )
    expect(action, 'the explicit schema should have refused this value').not.toHaveBeenCalled()
  })
})

describe('<TheoForm> context', () => {
  it('reports pending and success state to descendants', async () => {
    function Status(): React.JSX.Element {
      const { isPending, isSuccess } = useTheoFormState()
      return <p>{isPending ? 'sending' : isSuccess ? 'sent' : 'idle'}</p>
    }

    render(
      <TheoForm action={actionOf(() => Promise.resolve({}))} defaultValues={{ email: 'a@b.test' }}>
        <Body />
        <Status />
      </TheoForm>,
    )
    expect(screen.getByText('idle')).toBeTruthy()
    submit()

    await waitFor(() => expect(screen.getByText('sent')).toBeTruthy())
  })

  it('reset() clears the action result and the field values together', async () => {
    // Two stores, one button. Resetting only the action leaves the typed values behind, and
    // resetting only the form leaves a stale success banner — either half alone is a bug.
    function Reset(): React.JSX.Element {
      const { reset, isSuccess } = useTheoFormState()
      return (
        <>
          <p>{isSuccess ? 'sent' : 'idle'}</p>
          <button type="button" onClick={reset}>
            Reset
          </button>
        </>
      )
    }

    render(
      <TheoForm action={actionOf(() => Promise.resolve({}))} defaultValues={{ email: 'a@b.test' }}>
        <Body />
        <Reset />
      </TheoForm>,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typed@later.test' } })
    submit()
    await waitFor(() => expect(screen.getByText('sent')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => expect(screen.getByText('idle')).toBeTruthy())
    expect(screen.getByRole('textbox'), 'the form values were not reset').toHaveProperty(
      'value',
      'a@b.test',
    )
  })
})
