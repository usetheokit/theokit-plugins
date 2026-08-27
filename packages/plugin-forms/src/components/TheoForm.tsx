/**
 * Phase 4 / T4.1 — <TheoForm action={actions.X}> root component.
 *
 * Per plan p4-plugin-forms v1.1 ADR D1 (component, not render-prop) + D2
 * (schema from actions.X.__zodSchema) + D4 (useAction.isPending primary) +
 * D5 (JSON+devalue wire only).
 *
 * Composition:
 *   <TheoForm action={actions.saveMemory}>
 *     <TheoForm.Field name="conversationId">...</TheoForm.Field>
 *     <TheoForm.Field name="content">...</TheoForm.Field>
 *     <button type="submit">Save</button>
 *   </TheoForm>
 *
 * Internal wiring:
 *   - useAction(action) for mutate + pending + error
 *   - useForm({resolver: zodResolver(action.__zodSchema)}) for RHF state
 *   - FormProvider so descendants useFormContext()
 *   - TheoFormContext.Provider so descendants useTheoFormState()
 *   - handleValid passes RHF-validated input to useAction.mutateAsync;
 *     on ActionInputError-shape error → applyActionErrorsToForm bridges to RHF
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useAction } from 'theokit/client'
import { forwardRef, type ReactNode, useCallback } from 'react'
import {
  FormProvider,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
  useForm,
} from 'react-hook-form'
import { applyActionErrorsToForm } from '../adapter/applyActionErrorsToForm.js'
import { valuesToFormData } from '../adapter/valuesToFormData.js'
import {
  TheoFormContext,
  type TheoFormContextValue,
  type TheoFormErrorLike,
} from '../context/TheoFormContext.js'
import { TheoField } from './TheoField.js'

/**
 * Shape of the action callable returned by `@theo/actions` virtual module proxy.
 * Hard-typed callable + optional `__zodSchema` field per plan T1.1.
 *
 * Action is invoked with `mutateAsync(input)` — input MUST match `z.infer<__zodSchema>`.
 */
export interface TheoFormAction<TInput extends FieldValues = FieldValues, TData = unknown> {
  (
    input: TInput,
  ): Promise<{ data: TData; error: undefined } | { data: undefined; error: TheoFormErrorLike }>
  readonly __zodSchema?: {
    parse?: (input: unknown) => TInput
    safeParse?: (input: unknown) => { success: boolean; data?: TInput; error?: unknown }
  }
}

/**
 * A `FileList` becomes a `File[]`; everything else is returned as it came.
 *
 * NOT `Array.isArray`: a browser's `FileList` is array-like and not an `Array`, and this repository
 * cannot observe one — happy-dom's `DataTransfer.files` is itself an `Array`, measured. A check
 * that passes every test here and fails in the browser would be worse than none.
 */
function normaliseValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Blob || Array.isArray(value)) return value
  const length = (value as { length?: unknown }).length
  if (typeof length !== 'number') return value
  const items: Blob[] = []
  for (let i = 0; i < length; i += 1) {
    const item = (value as Record<number, unknown>)[i]
    if (!(item instanceof Blob)) return value
    items.push(item)
  }
  return items
}

/**
 * Unwrap `FileList` values BEFORE the schema sees them.
 *
 * This is the resolver, deliberately, and it took two wrong answers to get here. A registered file
 * input does not hold a `File`, so `z.array(z.instanceof(File))` — the shape the server's own
 * reconstruction produces — failed validation and the submit died before `handleValid` ever ran.
 * Unwrapping at conversion time is downstream of that. Unwrapping via `register`'s `setValueAs` is
 * upstream of it but never runs: measured, RHF does not call `setValueAs` for a file input; it
 * stores `event.target.files` directly.
 *
 * The resolver is the one place that sits between what RHF stores and what both the schema and the
 * submit handler receive — RHF passes the resolver's returned `values` to the submit handler, so
 * normalising here fixes validation and the payload in one move.
 */
function normaliseFileFields(inner: Resolver<never>): Resolver<never> {
  return ((values: Record<string, unknown>, context: unknown, options: unknown) => {
    const normalised: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values ?? {})) normalised[key] = normaliseValue(value)
    return (inner as unknown as (v: unknown, c: unknown, o: unknown) => unknown)(
      normalised,
      context,
      options,
    )
  }) as unknown as Resolver<never>
}

/**
 * Props for `<TheoForm>`.
 *
 * Only `action` and `children` are required: the schema normally travels on the action itself
 * (`action.__zodSchema`), which is what keeps client and server validating the same shape. Passing
 * `schema` is the escape hatch for an action that does not carry one; with neither, the form still
 * submits and still shows server-side field errors — it just does no client-side validation first.
 */
export interface TheoFormProps<TInput extends FieldValues = FieldValues, TData = unknown> {
  action: TheoFormAction<TInput, TData>
  /**
   * Initial values for the form. When omitted, RHF starts with empty/undefined.
   * Type-checked against `z.infer<typeof action.__zodSchema>` when schema present.
   */
  defaultValues?: Partial<TInput>
  /**
   * Schema escape hatch — when `action.__zodSchema` is undefined (consumer did
   * NOT follow shared-schema convention), pass schema explicitly here. When
   * both omitted, RHF runs without a resolver (client-side validation OFF;
   * server-side ActionInputError still hydrates via the adapter).
   */
  schema?: TheoFormAction<TInput, TData>['__zodSchema']
  /**
   * How the body is encoded.
   *
   * `multipart/form-data` converts the values to a `FormData` before invoking the action, shaped by
   * the schema so the server's own reconstruction reads it back. The action must declare
   * `accept: 'form'` server-side — that is where parsing happens, and this package cannot see it.
   *
   * Conversion is opt-in rather than inferred from the values: an action whose input is an object
   * on one submit and a `FormData` on the next cannot be typed, and nothing at the call site would
   * say why the body changed.
   *
   * Defaults to `application/x-www-form-urlencoded`, which is what every form rendered before this
   * prop existed. That value was hardcoded — the attribute a reader inspects to answer exactly this
   * question, answering it wrongly.
   */
  encType?: 'application/x-www-form-urlencoded' | 'multipart/form-data'
  /**
   * Optional callback fired AFTER successful submit (post-mutate). Useful for
   * navigation, toast, etc. Receives the server response data.
   */
  onSuccess?: (data: TData) => void
  /**
   * Children compose form fields, submit buttons, etc. Use `<TheoForm.Field>`
   * (styled tier) or `useTheoField(name)` (headless) to wire inputs.
   */
  children: ReactNode
  /** Additional class names for the <form> element. */
  className?: string
}

/**
 * Object.assign sub-parts pattern per ADR D1, mirroring theo-ui FormField at
 * form-field.tsx:209-214. Consumers may write `<TheoForm.Field>` or the flat
 * `<TheoField>` import — they are the same component.
 */
function TheoFormRootInner<TInput extends FieldValues, TData>(
  props: TheoFormProps<TInput, TData>,
  ref: React.ForwardedRef<HTMLFormElement>,
): React.JSX.Element {
  const { action, defaultValues, schema, encType, onSuccess, children, className } = props
  const action_ = useAction<TInput, TData>(action)
  // Schema priority: explicit prop > convention-attached __zodSchema > none
  const resolvedSchema = schema ?? action.__zodSchema
  const isMultipart = encType === 'multipart/form-data'
  if (isMultipart && resolvedSchema === undefined) {
    // At render, not at submit: the condition is decided by props alone, so waiting would delay a
    // developer error until a user triggers it (`rules/error-handling.md` § 3).
    throw new Error(
      'TheoForm: encType="multipart/form-data" needs a schema to convert with. Pass `schema`, or ' +
        'attach `__zodSchema` to the action — the conversion follows the same schema the server ' +
        'reconstructs the body with.',
    )
  }
  const resolver = resolvedSchema?.parse
    ? (normaliseFileFields(zodResolver(resolvedSchema as never)) as unknown as Resolver<TInput>)
    : undefined
  const form: UseFormReturn<TInput> = useForm<TInput>({
    defaultValues: defaultValues as never,
    ...(resolver ? { resolver } : {}),
  })

  const handleValid = useCallback(
    async (values: TInput) => {
      try {
        const payload = isMultipart
          ? (valuesToFormData(values, resolvedSchema as object) as never)
          : values
        const data = await action_.mutateAsync(payload)
        onSuccess?.(data)
      } catch (err) {
        // #227: route via the shared `routeActionError` (single source the unit
        // test also imports). Field errors → RHF setError; others re-thrown.
        // Cast: RHF's UseFormSetError narrows `name` to Path<TInput>, but the
        // adapter is duck-typed (works with any RHF form, not just known keys).
        routeActionError(
          err,
          form.setError as unknown as (n: string, e: { type: string; message: string }) => void,
        )
      }
    },
    [action_, form.setError, onSuccess, isMultipart, resolvedSchema],
  )

  const ctxValue: TheoFormContextValue = {
    isPending: action_.isPending,
    isSuccess: action_.isSuccess,
    isError: action_.isError,
    error: action_.error,
    data: action_.data,
    reset: () => {
      action_.reset()
      form.reset()
    },
  }

  return (
    <FormProvider {...form}>
      <TheoFormContext.Provider value={ctxValue}>
        <form
          ref={ref}
          onSubmit={(event) => void form.handleSubmit(handleValid)(event)}
          method="post"
          encType={encType ?? 'application/x-www-form-urlencoded'}
          {...(className !== undefined ? { className } : {})}
        >
          {children}
        </form>
      </TheoFormContext.Provider>
    </FormProvider>
  )
}

const TheoFormRoot = forwardRef(TheoFormRootInner) as <
  TInput extends FieldValues = FieldValues,
  TData = unknown,
>(
  props: TheoFormProps<TInput, TData> & { ref?: React.ForwardedRef<HTMLFormElement> },
) => React.JSX.Element

/**
 * <TheoForm> with sub-parts attached per ADR D1.
 * Consumers may use either:
 *   <TheoForm.Field name="x">...</TheoForm.Field>
 *   <TheoField name="x">...</TheoField>  (named import, same component)
 */
export const TheoForm = Object.assign(TheoFormRoot, {
  Field: TheoField,
})

// Duck-type detection of ActionInputError-shape error. We do NOT import the
// `ActionInputError` class from theokit/server to keep this peer-dep-free.
// Per `theokit/packages/theo/src/core/contracts/action-protocol.ts:149-175`:
// ActionInputError { code, status, type:'TheoActionInputError', fields, issues }
/**
 * Duck-type an ActionInputError by its `fields` map (#227 single source — both
 * `handleValid` and the unit test import THIS, never a copy).
 *
 * @public
 */
export function extractFieldsFromError(err: unknown): Record<string, string[]> | undefined {
  if (err === null || typeof err !== 'object') return undefined
  const obj = err as Record<string, unknown>
  const direct = readFieldsMap(obj)
  if (direct !== undefined) return direct
  // #175 — the SAME error, one level down. An action's declared return type is
  // `Promise<{ data, error }>`, so a caller that surfaces the envelope hands us
  // `{ data: undefined, error: { code, message, fields } }` and the `fields` map sits
  // inside `error`. Over HTTP the transport unwraps it first and the flat shape arrives,
  // which is why every integration test (200/422/404) passed while a LOCAL action — no
  // transport, envelope intact — fell through to the `throw err` in `routeActionError`
  // and surfaced as an unhandled rejection with no field error rendered anywhere.
  //
  // Reading both shapes rather than picking one: the flat form is what the HTTP path has
  // always produced and cannot be dropped, and the envelope is what the action's own type
  // says it returns. A duck-type that only knows one of them is a duck-type that knows the
  // transport, which is exactly what this helper exists to avoid.
  return readFieldsMap(obj.error)
}

/** The `fields` map on a value, when it carries one. */
function readFieldsMap(value: unknown): Record<string, string[]> | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const fields = (value as Record<string, unknown>).fields
  if (fields === null || typeof fields !== 'object') return undefined
  return fields as Record<string, string[]>
}

/**
 * Route an action error to the form (#227): ActionInputError-shaped `fields`
 * are bridged into RHF `setError`; any other error is re-thrown (fail-fast — we
 * never silently swallow arbitrary errors, only validation ones are form-local).
 * Exported so the component and its unit test share ONE implementation.
 *
 * @public
 */
export function routeActionError(
  err: unknown,
  setError: (name: string, error: { type: string; message: string }) => void,
): void {
  const fields = extractFieldsFromError(err)
  if (fields !== undefined) {
    applyActionErrorsToForm(setError, fields)
  } else {
    throw err
  }
}
