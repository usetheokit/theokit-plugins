// @vitest-environment happy-dom
/**
 * The unwrap has to happen where the value is STORED, not where it is converted.
 *
 * Measured: `zodResolver` validates the values `react-hook-form` holds, and `handleValid` — where
 * the multipart conversion lives — runs only if that passed. A registered file input does not hold
 * a `File`, so `z.array(z.instanceof(File))` used to fail at the resolver and the action was never
 * called at all. Unwrapping at conversion time is downstream of a submit that already died.
 */
import { render, fireEvent, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { TheoForm } from '../../src/components/TheoForm.js'
import { TheoField, useTheoFieldRegister } from '../../src/components/TheoField.js'

function Control({ type }: { type: string }): React.JSX.Element {
  const register = useTheoFieldRegister()
  return <input type={type} data-testid="c" {...register} />
}

function mount(schema: z.ZodTypeAny, type: string, onCall: (v: unknown) => void) {
  const action = Object.assign(
    (input: unknown) => {
      onCall(input)
      return Promise.resolve({ data: 'ok', error: undefined })
    },
    { __zodSchema: schema },
  )
  return render(
    <TheoForm action={action as never} schema={schema as never}>
      <TheoField name="doc">
        <Control type={type} />
      </TheoField>
    </TheoForm>,
  )
}

describe('a registered file input', () => {
  it('reaches the action with the natural file schema', async () => {
    // Fails before the normalisation: RHF holds a FileList-like, the resolver rejects it against
    // `z.instanceof(File)`, and `handleValid` never runs.
    let received: unknown
    const schema = z.object({ doc: z.array(z.instanceof(File)) })
    const { getByTestId, container } = mount(schema, 'file', (v) => (received = v))

    const input = getByTestId('c') as HTMLInputElement
    const file = new File(['payload'], 'a.txt', { type: 'text/plain' })
    Object.defineProperty(input, 'files', { value: { 0: file, length: 1 }, writable: true })
    fireEvent.change(input)
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(received, 'the submit died at the resolver').toBeDefined())
    const docs = (received as { doc: unknown[] }).doc
    expect(Array.isArray(docs), 'the FileList was not normalised to an array').toBe(true)
    expect(docs[0]).toBeInstanceOf(File)
  })

  it('leaves a non-file field untouched', async () => {
    // The normalisation runs on EVERY registered field. A bug here breaks text inputs too.
    let received: unknown
    const schema = z.object({ doc: z.string() })
    const { getByTestId, container } = mount(schema, 'text', (v) => (received = v))

    fireEvent.change(getByTestId('c'), { target: { value: 'plain text' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(received).toBeDefined())
    expect((received as { doc: unknown }).doc).toBe('plain text')
  })
})
