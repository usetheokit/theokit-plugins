/**
 * Phase 3 / T3.2 — useTheoField headless hook tests per plan p4-plugin-forms v1.1.
 */
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { useTheoField } from '../../src/hooks/useTheoField.js'

function wrapWithForm(defaultValues: Record<string, unknown> = {}) {
  return ({ children }: { children: ReactNode }) => {
    const form = useForm({ defaultValues })
    return <FormProvider {...form}>{children}</FormProvider>
  }
}

describe('useTheoField', () => {
  it('returns register props with the field name and onChange/onBlur/ref', () => {
    const { result } = renderHook(() => useTheoField('email'), {
      wrapper: wrapWithForm({ email: '' }),
    })
    expect(result.current.register.name).toBe('email')
    expect(typeof result.current.register.onChange).toBe('function')
    expect(typeof result.current.register.onBlur).toBe('function')
    expect(typeof result.current.register.ref).toBe('function')
  })

  it('reflects setValue updates via the returned imperative setter', () => {
    const { result } = renderHook(() => useTheoField('name'), {
      wrapper: wrapWithForm({ name: '' }),
    })
    act(() => {
      result.current.setValue('Alice')
    })
    expect(result.current.value).toBe('Alice')
  })

  it('reflects setError via the RHF form context — isInvalid + error.message populate', () => {
    let formApi: UseFormReturn<{ name: string }> | null = null
    const wrapper = ({ children }: { children: ReactNode }) => {
      formApi = useForm({ defaultValues: { name: '' } })
      return <FormProvider {...formApi}>{children}</FormProvider>
    }
    const { result, rerender } = renderHook(() => useTheoField('name'), { wrapper })
    expect(result.current.isInvalid).toBe(false)
    expect(result.current.error).toBeUndefined()
    act(() => {
      formApi!.setError('name', { type: 'server', message: 'Required' })
    })
    rerender()
    expect(result.current.isInvalid).toBe(true)
    expect(result.current.error?.message).toBe('Required')
    expect(result.current.error?.type).toBe('server')
  })

  it('refuses to run outside a <TheoForm>, naming what to wrap the tree in', () => {
    // The typed refusal the hook exists to give (`rules/error-handling.md`: explicit, with
    // enough context to act on). Without a FormProvider the RHF context is null, and returning
    // an empty field state here would let a form render clean and silently never bind.
    expect(() => renderHook(() => useTheoField('name'))).toThrow(
      /must be called from a descendant of <TheoForm>/,
    )
  })

  it('reports no error for a parent path whose child holds the error', () => {
    // `errors.address` is an object once `address.city` fails, but it is a BRANCH of the error
    // tree, not an error: it has neither `message` nor `type`. Treating it as one would mark
    // the group invalid and render an empty message beside a field that is fine.
    let formApi: UseFormReturn<{ address: { city: string } }> | null = null
    const wrapper = ({ children }: { children: ReactNode }) => {
      formApi = useForm({ defaultValues: { address: { city: '' } } })
      return <FormProvider {...formApi}>{children}</FormProvider>
    }
    const { result, rerender } = renderHook(
      () => ({ parent: useTheoField('address'), child: useTheoField('address.city') }),
      { wrapper },
    )
    act(() => {
      formApi!.setError('address.city', { type: 'server', message: 'Unknown city' })
    })
    rerender()

    expect(result.current.child.isInvalid, 'the field that failed').toBe(true)
    expect(result.current.child.error?.message).toBe('Unknown city')
    expect(result.current.parent.isInvalid, 'the group containing it').toBe(false)
    expect(result.current.parent.error).toBeUndefined()
  })
})
