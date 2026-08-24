// @vitest-environment happy-dom
/**
 * `encType` stops being decorative.
 *
 * It was hardcoded `application/x-www-form-urlencoded` on every form — the attribute a reader
 * inspects to answer exactly this question, answering it wrongly. It is now the opt-in: declaring
 * `multipart/form-data` converts the values before the action is invoked, and declaring nothing
 * leaves behaviour byte-for-byte as it was.
 *
 * Conversion is NOT inferred from the values. An action whose input is an object on one submit and
 * a `FormData` on the next cannot be typed, and nothing at the call site would say why the body
 * changed.
 */
import { render, fireEvent, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { TheoForm } from '../../src/components/TheoForm.js'
import { TheoField, useTheoFieldRegister } from '../../src/components/TheoField.js'

function Control({ type = 'text' }: { type?: string }): React.JSX.Element {
  const register = useTheoFieldRegister()
  return <input type={type} data-testid="c" {...register} />
}

const SCHEMA = z.object({ title: z.string() })

function mount(
  received: (input: unknown) => void,
  encType?: 'application/x-www-form-urlencoded' | 'multipart/form-data',
  schema: z.ZodTypeAny | undefined = SCHEMA,
) {
  const action = Object.assign(
    (input: unknown) => {
      received(input)
      return Promise.resolve({ data: 'ok', error: undefined })
    },
    schema ? { __zodSchema: schema } : {},
  )
  return render(
    <TheoForm
      action={action as never}
      {...(schema ? { schema: schema as never } : {})}
      {...(encType ? { encType } : {})}
    >
      <TheoField name="title">
        <Control />
      </TheoField>
    </TheoForm>,
  )
}

describe('encType', () => {
  it('carries the declared value into the rendered form', () => {
    const { container } = mount(() => undefined, 'multipart/form-data')

    expect(container.querySelector('form')?.getAttribute('enctype')).toBe('multipart/form-data')
  })

  it('still renders urlencoded by default', () => {
    // The additive check: a consumer who passes nothing gets today's markup exactly.
    const { container } = mount(() => undefined)

    expect(container.querySelector('form')?.getAttribute('enctype')).toBe(
      'application/x-www-form-urlencoded',
    )
  })
})

describe('what the action receives', () => {
  it('is a FormData when multipart is declared', async () => {
    let got: unknown
    const { getByTestId, container } = mount((v) => (got = v), 'multipart/form-data')

    fireEvent.change(getByTestId('c'), { target: { value: 'a title' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(got).toBeDefined())
    expect(got).toBeInstanceOf(FormData)
    expect((got as FormData).get('title')).toBe('a title')
  })

  it('is a plain object by default', async () => {
    let got: unknown
    const { getByTestId, container } = mount((v) => (got = v))

    fireEvent.change(getByTestId('c'), { target: { value: 'a title' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(got).toBeDefined())
    expect(got, 'an existing consumer saw its payload change shape').not.toBeInstanceOf(FormData)
    expect(got).toMatchObject({ title: 'a title' })
  })

  it('refuses multipart without a schema, at render, naming both', () => {
    // R3, and it fails at RENDER rather than at submit. The condition is static — it is decided by
    // props alone — so waiting for a submit would delay a developer error until a user triggers it,
    // against `rules/error-handling.md` § 3 ("fail as early as possible"). A half-built body would
    // otherwise reach the server as a set of missing fields rather than as an error.
    const action = (): Promise<unknown> => Promise.resolve({ data: 'ok', error: undefined })

    expect(() =>
      render(
        <TheoForm action={action as never} encType="multipart/form-data">
          <TheoField name="title">
            <Control />
          </TheoField>
        </TheoForm>,
      ),
    ).toThrow(/encType.*schema|schema.*encType/s)
  })
})
