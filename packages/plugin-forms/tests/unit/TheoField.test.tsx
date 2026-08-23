/**
 * `<TheoField>` — the scope that makes a field's label, control and error point at each other.
 *
 * This component was at 8.33% line coverage: everything below its props interface was
 * unexecuted, including both of its typed errors and the whole render. Nothing here had ever
 * been mounted.
 *
 * What that left unprotected is the part its own docblock calls out: "wiring that is easy to get
 * subtly wrong by hand and invisible when it is wrong to anyone not using a screen reader". A
 * broken `htmlFor`/`id` pair renders identically to a correct one. So these tests assert the
 * ACCESSIBLE relationships — the label points at the control, the error is announced through
 * `aria-describedby`, `aria-invalid` follows the field's state — rather than that a div exists.
 *
 * The two hooks are covered on their failure path as well as their success path. They throw on
 * purpose (`rules/error-handling.md`: explicit, typed, with a message that says what to do), and
 * a throw nobody asserts is a message free to rot.
 */

import { render, screen } from '@testing-library/react'
import { FormField } from '@usetheo/ui'
import type { ReactNode } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import {
  TheoField,
  useTheoFieldRegister,
  useTheoFieldScope,
} from '../../src/components/TheoField.js'

/** A form context without a `<TheoForm>`: `TheoField` needs RHF, not the whole component. */
function WithForm({ children, errors }: { children: ReactNode; errors?: Record<string, string> }) {
  function Inner(): React.JSX.Element {
    const form = useForm({ defaultValues: { email: '' } })
    for (const [name, message] of Object.entries(errors ?? {})) {
      form.setError(name as never, { type: 'server', message })
    }
    return <FormProvider {...form}>{children}</FormProvider>
  }
  return <Inner />
}

/**
 * A control wired the way the README tells a consumer to wire one.
 *
 * `FormField.Control` lives INSIDE this component on purpose: it clones its direct child to
 * inject `id` / `aria-invalid` / `aria-describedby`, so that child has to be the real `<input>`.
 * The README used to put a consumer component in that slot, which silently swallowed all three
 * (#105) — and these assertions are what caught it.
 */
function Control(): React.JSX.Element {
  const register = useTheoFieldRegister()
  return (
    <FormField.Control>
      <input {...register} />
    </FormField.Control>
  )
}

describe('<TheoField> scope', () => {
  it('gives a descendant input the register props for its own field name', () => {
    render(
      <WithForm>
        <TheoField name="email">
          <Control />
        </TheoField>
      </WithForm>,
    )

    expect(screen.getByRole('textbox')).toHaveProperty('name', 'email')
  })

  it('exposes the field state to a descendant through useTheoFieldScope()', () => {
    function ReadsScope(): React.JSX.Element {
      const { isInvalid, error } = useTheoFieldScope()
      return <p>{isInvalid ? `invalid: ${error?.message ?? ''}` : 'valid'}</p>
    }

    render(
      <WithForm errors={{ email: 'Email is already taken' }}>
        <TheoField name="email">
          <ReadsScope />
        </TheoField>
      </WithForm>,
    )

    expect(screen.getByText('invalid: Email is already taken')).toBeTruthy()
  })
})

describe('<TheoField> accessible wiring', () => {
  it('points the label at the control it labels', () => {
    render(
      <WithForm>
        <TheoField name="email">
          <FormField.Label>Email</FormField.Label>
          <Control />
        </TheoField>
      </WithForm>,
    )

    // getByLabelText resolves through htmlFor/id, so it FAILS when the pair is broken —
    // which is the failure a sighted reviewer cannot see.
    expect(screen.getByLabelText('Email')).toBe(screen.getByRole('textbox'))
  })

  it('marks the control invalid when the field has an error', () => {
    render(
      <WithForm errors={{ email: 'Required' }}>
        <TheoField name="email">
          <Control />
        </TheoField>
      </WithForm>,
    )

    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true')
  })

  it('leaves the control valid when the field has no error', () => {
    render(
      <WithForm>
        <TheoField name="email">
          <Control />
        </TheoField>
      </WithForm>,
    )

    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).not.toBe('true')
  })
})

describe('<TheoField> scope hooks outside a field', () => {
  it('useTheoFieldRegister() refuses, naming what to wrap it in', () => {
    function Orphan(): React.JSX.Element {
      return <input {...useTheoFieldRegister()} />
    }
    expect(() =>
      render(
        <WithForm>
          <Orphan />
        </WithForm>,
      ),
    ).toThrow(/must be called from a descendant of <TheoField>/)
  })

  it('useTheoFieldScope() refuses, naming what to wrap it in', () => {
    function Orphan(): React.JSX.Element {
      useTheoFieldScope()
      return <p>unreachable</p>
    }
    expect(() =>
      render(
        <WithForm>
          <Orphan />
        </WithForm>,
      ),
    ).toThrow(/must be called from a descendant of <TheoField>/)
  })
})
