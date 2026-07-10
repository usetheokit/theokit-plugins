/**
 * Phase 3 / T3.2 — useTheoField headless hook per plan p4-plugin-forms v1.1 ADR D6.
 *
 * Headless escape hatch for consumers that do NOT use @theokit/ui primitives
 * (shadcn, MUI, Mantine, raw HTML). Returns RHF field state + register props
 * with NO opinion on rendering.
 *
 * Uses RHF's useFormContext (must be inside <FormProvider> — supplied by
 * <TheoForm> root) + useFormState (subscribes only to the named field's error
 * for perf).
 *
 * Why duck-type RHF: RHF's UseFormReturn type surface is large; the hook
 * narrows to the field-relevant slice so consumers don't need full RHF API.
 */
import { useFormContext, useFormState } from 'react-hook-form'

export interface UseTheoFieldResult {
  /** Current value of the field (reactive). */
  value: unknown
  /** RHF error object for this field, or undefined. */
  error: { type?: string; message?: string } | undefined
  /** Convenience: error !== undefined. */
  isInvalid: boolean
  /**
   * RHF register props — spread onto the underlying input:
   *   <input {...field.register} />
   * Provides name, onChange, onBlur, ref. RHF v7+ shape.
   */
  register: ReturnType<ReturnType<typeof useFormContext>['register']>
  /** Imperative setter — calls RHF's setValue with shouldDirty=true. */
  setValue: (value: unknown) => void
}

/**
 * Subscribe to a single field by name. Re-renders only when the field's
 * value or error changes (RHF handles subscription internally).
 *
 * @param name — dot-notation full path (matches TheoKit ActionInputError.fields keys)
 */
export function useTheoField(name: string): UseTheoFieldResult {
  const form = useFormContext()
  if (form === null) {
    throw new Error(
      'useTheoField() must be called from a descendant of <TheoForm>. ' +
        'Wrap your component tree with <TheoForm action={...}> first ' +
        '(<TheoForm> provides the RHF FormProvider internally).',
    )
  }
  const { errors } = useFormState({ control: form.control, name })
  // Walk dot-notation path through nested errors to handle 'user.address.zip'
  const error = walkErrorsByPath(errors, name)
  const value: unknown = form.watch(name)
  const register = form.register(name)
  const setValue = (v: unknown): void => {
    form.setValue(name, v, { shouldDirty: true, shouldTouch: true })
  }
  return {
    value,
    error,
    isInvalid: error !== undefined,
    register,
    setValue,
  }
}

/**
 * Walk a dot-notation path through RHF's nested FieldErrors object.
 * Returns the leaf FieldError ({type, message, ref?}) if found.
 *
 * RHF accepts flat keys via setError('a.b.c', ...) but exposes them
 * as nested objects at formState.errors. This walker bridges the gap.
 */
function walkErrorsByPath(
  errors: Record<string, unknown>,
  path: string,
): { type?: string; message?: string } | undefined {
  const segments = path === '' ? ['root'] : path.split('.')
  let current: unknown = errors
  for (const seg of segments) {
    if (current === undefined || current === null) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[seg]
  }
  if (current === undefined || current === null) return undefined
  if (typeof current !== 'object') return undefined
  const candidate = current as { type?: unknown; message?: unknown }
  if (typeof candidate.message === 'string' || typeof candidate.type === 'string') {
    return {
      type: typeof candidate.type === 'string' ? candidate.type : undefined,
      message: typeof candidate.message === 'string' ? candidate.message : undefined,
    }
  }
  return undefined
}
