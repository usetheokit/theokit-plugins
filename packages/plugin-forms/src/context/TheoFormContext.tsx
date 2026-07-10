/**
 * Phase 3 / T3.1 — TheoFormContext per plan p4-plugin-forms v1.1 ADR D4.
 *
 * Provides form-level state (pending, error, data, reset) to descendants of
 * <TheoForm> without prop drilling. Mirrors theo-ui FormField's useFormField
 * pattern (form-field.tsx:53-57) — Context with actionable error on misuse.
 *
 * Why Context (not props): submit buttons, status indicators, and TheoField
 * sub-parts all need to read isPending or error. Drilling props through
 * arbitrary JSX trees is fragile; React.Context is the canonical answer.
 *
 * Why source = useAction.isPending (per D4): single source of truth. React 19
 * useFormStatus would report pending:false under JSON+devalue wire (D5) because
 * submission goes through mutateAsync, not native form action.
 */
import { createContext, useContext } from 'react'

/**
 * Minimal error shape consumed by descendants. Compatible with both
 * TheoKit ActionError and ActionInputError, but NOT importing those classes
 * (peer-dep avoidance — plugin works with any G3-compatible error envelope).
 */
export interface TheoFormErrorLike {
  code: string
  message: string
  status?: number
  fields?: Record<string, string[]>
  issues?: unknown[]
  type?: string
}

/**
 * Context value shape. Provider lives in <TheoForm> root (Phase 4).
 * Consumer hook is useTheoFormState() below.
 */
export interface TheoFormContextValue {
  /** True while useAction.mutateAsync is in flight. */
  isPending: boolean
  /** True after last successful submission until reset(). */
  isSuccess: boolean
  /** True after last failed submission until reset() / re-submit. */
  isError: boolean
  /** Last error from the action call, or undefined. */
  error: TheoFormErrorLike | undefined
  /** Last successful response data, or undefined. */
  data: unknown
  /** Reset both useAction state AND the RHF form to initial values. */
  reset: () => void
}

/**
 * The Context itself. Default null so misuse throws an actionable error
 * via useTheoFormState (rather than silently returning bogus state).
 */
export const TheoFormContext = createContext<TheoFormContextValue | null>(null)

/**
 * Hook consumed by descendants of <TheoForm>. Returns the live form state.
 * Throws an actionable error if invoked outside a <TheoForm> Provider —
 * mirrors theo-ui's `useFormField` enforcement (form-field.tsx:55).
 */
export function useTheoFormState(): TheoFormContextValue {
  const ctx = useContext(TheoFormContext)
  if (ctx === null) {
    throw new Error(
      'useTheoFormState() must be called from a descendant of <TheoForm>. ' +
        'Wrap your component tree with <TheoForm action={...}> first.',
    )
  }
  return ctx
}
