/**
 * Turn a form's values into the `FormData` shape `theokit` reconstructs.
 *
 * This is the mirror of the framework's `formDataToObject`, and the reason it is a shipped function
 * rather than a README snippet is that its convention is **not the obvious one**:
 *
 *   - nested objects use dot notation (`user.address.zip`), which the other side finds by scanning
 *     for the `user.address.` prefix;
 *   - arrays use **repeated keys** — `tags` twice — because the other side calls
 *     `formData.getAll('tags')`.
 *
 * A hand-rolled walk produces `tags[0]` / `tags[1]` instead. `getAll('tags')` then finds nothing and
 * the array arrives **empty, with no error anywhere**. Every consumer would write that same bug, and
 * none of them would see it fail.
 *
 * It walks the SCHEMA rather than the values, for the same reason the other side does: an empty
 * array and a missing key are indistinguishable from the values alone, and the two sides have to
 * agree about which is which.
 *
 * `tests/integration/multipart-round-trip.test.ts` runs the framework's real reconstruction against
 * this output, so a divergence fails in this repository rather than in somebody's upload.
 *
 * @public
 */

/** The minimum of a Zod schema this needs, described rather than imported. */
interface ZodLike {
  readonly def?: { readonly type?: unknown; readonly element?: unknown; readonly innerType?: unknown }
  readonly _def?: { readonly innerType?: unknown }
  readonly shape?: Record<string, ZodLike>
}

/** Zod's class names, read off the constructor so this file needs no `zod` import. */
function kindOf(validator: ZodLike): string {
  return (validator as { constructor?: { name?: string } }).constructor?.name ?? ''
}

/**
 * Strip `optional` / `nullable` / `default` to reach the validator that describes the shape.
 *
 * Without this an optional array reads as a scalar and is emitted as one comma-joined key — the
 * same silent-wrong-shape failure the repeated-key convention exists to avoid.
 */
function unwrapWrappers(validator: ZodLike): ZodLike {
  let inner = validator
  for (;;) {
    const kind = kindOf(inner)
    if (kind !== 'ZodOptional' && kind !== 'ZodNullable' && kind !== 'ZodDefault') return inner
    const next = (inner.def?.innerType ?? inner._def?.innerType) as ZodLike | undefined
    if (next === undefined) return inner
    inner = next
  }
}

/**
 * Is this an array-like of `Blob`s?
 *
 * NOT `Array.isArray`. A browser hands `react-hook-form` a `FileList`, which is array-like and not
 * an `Array` — and this repository cannot observe one: happy-dom's `DataTransfer.files` is itself an
 * `Array`, measured. Branching on `Array.isArray` would pass every test here and fail in the only
 * environment that matters, with a green suite as the evidence.
 */
function asBlobList(value: unknown): Blob[] | undefined {
  if (value instanceof Blob) return [value]
  if (value === null || typeof value !== 'object') return undefined
  const length = (value as { length?: unknown }).length
  if (typeof length !== 'number') return undefined
  const items: Blob[] = []
  for (let i = 0; i < length; i += 1) {
    const item = (value as Record<number, unknown>)[i]
    if (!(item instanceof Blob)) return undefined
    items.push(item)
  }
  return items
}

/** How the other side's `coerceScalar` / `coerceBoolean` read a value back. */
function encodeScalar(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function appendValue(form: FormData, key: string, value: unknown, validator: ZodLike): void {
  if (value === undefined || value === null) return

  const blobs = asBlobList(value)
  if (blobs !== undefined) {
    // One key per file, repeated — the same convention arrays use, so a single-file field and a
    // multi-file field differ only in the schema that reads them back.
    for (const blob of blobs) {
      form.append(key, blob, blob instanceof File ? blob.name : undefined)
    }
    return
  }

  const kind = kindOf(validator)

  if (kind === 'ZodObject' && typeof value === 'object') {
    const shape = validator.shape ?? {}
    for (const [childKey, childValidator] of Object.entries(shape)) {
      appendValue(
        form,
        `${key}.${childKey}`,
        (value as Record<string, unknown>)[childKey],
        unwrapWrappers(childValidator),
      )
    }
    return
  }

  if (kind === 'ZodArray' && Array.isArray(value)) {
    const element = (validator.def?.element ?? validator.def?.type) as ZodLike | undefined
    const elementValidator = element ? unwrapWrappers(element) : ({} as ZodLike)
    // An empty array emits NOTHING. Emitting a placeholder would reconstruct as a one-element
    // array holding an empty string, which is a different value than the one submitted.
    for (const item of value) appendValue(form, key, item, elementValidator)
    return
  }

  form.append(key, encodeScalar(value))
}

/**
 * Convert `values` to `FormData`, shaped by `schema`.
 *
 * @param values - the form's values, as `react-hook-form` holds them
 * @param schema - the same Zod object schema the action validates with; the walk follows it, not
 *   the values
 * @public
 */
export function valuesToFormData(values: Record<string, unknown>, schema: object): FormData {
  const form = new FormData()
  const shape = unwrapWrappers(schema as ZodLike).shape
  if (shape === undefined) {
    throw new Error(
      'valuesToFormData: the schema has no object shape to walk. ' +
        'multipart/form-data conversion needs the action\'s Zod object schema — the same one the ' +
        'server reconstructs with.',
    )
  }
  for (const [key, validator] of Object.entries(shape)) {
    appendValue(form, key, values[key], unwrapWrappers(validator))
  }
  return form
}
