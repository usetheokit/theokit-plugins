/**
 * Phase 4 / T4.2 — <TheoField name="..."> styled tier component.
 *
 * Per plan p4-plugin-forms v1.1 ADR D6 (styled tier wrapping the design system's FormField).
 *
 * v0.1.1 change (P#4 EC-10 hardening):
 *   Previous v0.1.0 used `(globalThis as {require?...}).require?.(...)` lazy
 *   loader that ALWAYS fails in browser ESM context (globalThis.require is
 *   undefined). Switched to a static ESM import — clearer failure mode:
 *   importing <TheoField> without `@usetheo/ui` installed produces a module-
 *   resolution error at load time, not a render-time throw. Consumers without
 *   @usetheo/ui MUST use `useTheoField()` headless hook (still works peer-free).
 *
 * Composition (v0.1.x):
 *   <TheoField name="email">
 *     <FormField.Label>Email</FormField.Label>
 *     <FormField.Control>
 *       <Input {...useTheoFieldRegister()} />
 *     </FormField.Control>
 *     <FormField.Error />
 *   </TheoField>
 */
// `FormField` comes from `@usetheo/ui`, not `@theokit/ui`. The v1 split of
// `@theokit/ui` moved the 54 non-AI components — FormField among them — to
// `@usetheo/ui`, leaving `@theokit/ui` AI-exclusive. See that package's
// wiki/migrations/v1-usetheo-ui-split.md.
//
// IMPORTANT: import from the main barrel "@usetheo/ui" (NOT sub-path
// "@usetheo/ui/form-field"). The sub-path bypasses Vite's optimizeDeps
// bundling, while consumers typically import via main barrel; mixing
// produces two FormFieldContext instances at runtime and useFormField()
// reads null inside <FormField.Control>. Documented as v0.1.2 hotfix.
import { FormField } from '@usetheo/ui'
import { createContext, useContext, type ReactNode } from 'react'
import { type FieldValues } from 'react-hook-form'
import { useTheoField, type UseTheoFieldResult } from '../hooks/useTheoField.js'

/**
 * Internal Context — supplies the current field's useTheoField result to
 * descendants. Consumer's `<Input {...useTheoFieldRegister()}/>` reads from
 * this Context to get the register props for the current TheoField scope.
 */
const TheoFieldScopeContext = createContext<UseTheoFieldResult | null>(null)

/**
 * Hook for descendants of <TheoField> to pull RHF register props.
 * Spread onto your input: `<input {...useTheoFieldRegister()} />`.
 * Throws when used outside a <TheoField name="..."> wrapper.
 */
export function useTheoFieldRegister(): UseTheoFieldResult['register'] {
  const ctx = useContext(TheoFieldScopeContext)
  if (ctx === null) {
    throw new Error(
      'useTheoFieldRegister() must be called from a descendant of <TheoField>. ' +
        'Wrap your input scope with <TheoField name="..."> first.',
    )
  }
  return ctx.register
}

/**
 * Hook for descendants of <TheoField> to read the field's full state
 * (value, error, isInvalid, setValue). Useful for custom error rendering.
 * Throws when used outside a <TheoField>.
 */
export function useTheoFieldScope(): UseTheoFieldResult {
  const ctx = useContext(TheoFieldScopeContext)
  if (ctx === null) {
    throw new Error(
      'useTheoFieldScope() must be called from a descendant of <TheoField>. ' +
        'Wrap your input scope with <TheoField name="..."> first.',
    )
  }
  return ctx
}

/**
 * Props for `<TheoField>`.
 *
 * `name` is the dot-notation path into the form schema (`"user.address.zip"`), not a display label:
 * it is what binds the field to its value and to the server's per-field errors.
 */
export interface TheoFieldProps {
  /** Dot-notation full path matching the form schema (e.g. "user.address.zip"). */
  name: string
  /**
   * Children compose `<FormField.Label>`, `<FormField.Control>`,
   * `<FormField.Hint>`, `<FormField.Error>` from `@theokit/ui`.
   * Input inside `<FormField.Control>` should spread `useTheoFieldRegister()`.
   */
  children: ReactNode
}

/**
 * Scope one named field of the surrounding `<TheoForm>`.
 *
 * It renders no input of its own. It establishes the scope that `<FormField.Label>`,
 * `<FormField.Control>`, `<FormField.Hint>` and `<FormField.Error>` read, so the label points at
 * the right control and the error appears next to the field that produced it — wiring that is easy
 * to get subtly wrong by hand and invisible when it is wrong to anyone not using a screen reader.
 *
 * @public
 */
export function TheoField<_TInput extends FieldValues = FieldValues>(
  props: TheoFieldProps,
): React.JSX.Element {
  const { name, children } = props
  const field = useTheoField(name)
  return (
    <TheoFieldScopeContext.Provider value={field}>
      <FormField invalid={field.isInvalid}>{children}</FormField>
    </TheoFieldScopeContext.Provider>
  )
}
