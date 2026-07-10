/**
 * Phase 3 / T3.2 — useTheoField headless hook tests per plan p4-plugin-forms v1.1.
 */
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
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
    let formApi: ReturnType<typeof useForm> | null = null
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
})
