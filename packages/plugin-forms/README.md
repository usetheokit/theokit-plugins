# @theokit/plugin-forms

Declarative form binding for TheoKit. Glues `zod` + `react-hook-form` + `useAction` (from `@theokit/react`) into a single `<TheoForm action={actions.X}>` component. Field-level errors from `ActionInputError.fields` map straight into the form via a small adapter; pending state flows through Context.

> **Status:** v0.1.0 (early). Requires JavaScript on the client (no progressive enhancement in v0.1 — see Limitations).

## Install

```bash
pnpm add @theokit/plugin-forms react-hook-form @hookform/resolvers zod
# Optional (recommended) for the styled <TheoField> tier:
pnpm add @usetheo/ui
```

Peer-dep matrix:

| Package               | Range                 | Required?                                             |
| --------------------- | --------------------- | ----------------------------------------------------- |
| `react`               | `>=19.0.0`            | yes                                                   |
| `react-hook-form`     | `^7.50.0`             | yes                                                   |
| `@hookform/resolvers` | `^5.0.0`              | yes                                                   |
| `zod`                 | `^3.25.0 \|\| ^4.0.0` | yes (matches `@theokit/sdk` peer range)               |
| `theokit`             | `>=0.2.3`             | yes (G3 `__zodSchema` extension)                      |
| `@theokit/react`      | `>=1.1.0`             | yes (`useAction` hook)                                |
| `@usetheo/ui`         | `>=0.14.0`            | **optional** (only for the styled `<TheoField>` tier) |

## Convention — shared schemas

Author each action's input schema in an **isomorphic** file under `server/actions/schemas/<name>.ts`:

```ts
// server/actions/schemas/save-memory.ts
import { z } from 'zod'
export const schema = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1),
})
```

Then import it from the action handler:

```ts
// server/actions/save-memory.ts
import { defineAction } from 'theokit/server'
import { schema } from './schemas/save-memory.js'
export const saveMemory = defineAction({
  input: schema,
  handler: async ({ input }) => {
    // persist input.content under input.conversationId
    return { id: 'mem_...' }
  },
})
```

The TheoKit Vite plugin detects the convention and exposes the schema at runtime as `actions.saveMemory.__zodSchema`. `<TheoForm>` reads it to drive RHF's `zodResolver` — no client re-declaration.

## Cookbook 1 — basic form with `<TheoForm.Field>` (styled tier)

```tsx
'use client'
import { actions } from '@theo/actions'
import { TheoForm, TheoField, useTheoFieldRegister } from '@theokit/plugin-forms'
import { FormField, Input, Button } from '@usetheo/ui'

function InputForCurrentField() {
  const register = useTheoFieldRegister()
  return <Input {...register} placeholder="Type something..." />
}

export default function MemoryPage() {
  return (
    <TheoForm
      action={actions.saveMemory}
      defaultValues={{ conversationId: 'default', content: '' }}
      onSuccess={(data) => console.log('Saved:', data)}
    >
      <input type="hidden" name="conversationId" value="default" readOnly />
      <TheoField name="content">
        <FormField.Label required>Memory</FormField.Label>
        <FormField.Control>
          <InputForCurrentField />
        </FormField.Control>
        <FormField.Error />
      </TheoField>
      <Button type="submit">Save</Button>
    </TheoForm>
  )
}
```

What's happening:

- `<TheoForm action={actions.saveMemory}>` wires `useAction` + RHF `useForm({resolver: zodResolver(actions.saveMemory.__zodSchema)})` + provides Context.
- `<TheoField name="content">` reads RHF state for the field; renders `<FormField invalid={hasError}>` from `@usetheo/ui`.
- `useTheoFieldRegister()` inside the descendant input pulls RHF's `register` props and spreads them onto the `<Input>`.
- On submit failure with `ActionInputError`, `<FormField.Error/>` populates from `errors.content.message` via the internal adapter.

## Cookbook 2 — pending state via `useTheoFormState`

Submit buttons (and any descendant) read pending/error/data via Context:

```tsx
import { useTheoFormState } from '@theokit/plugin-forms'
import { Button } from '@usetheo/ui'

function SubmitButton() {
  const { isPending, isError, error } = useTheoFormState()
  return (
    <>
      {isError && <p role="alert">{error?.message ?? 'Submission failed'}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save'}
      </Button>
    </>
  )
}
```

## Cookbook 3 — headless `useTheoField` (no `@usetheo/ui`)

For consumers who don't use `@usetheo/ui` (shadcn primitives, MUI, raw HTML):

```tsx
'use client'
import { actions } from '@theo/actions'
import { TheoForm, useTheoField } from '@theokit/plugin-forms'

function MyField({ name, label }: { name: string; label: string }) {
  const field = useTheoField(name)
  return (
    <label>
      {label}
      <input {...field.register} />
      {field.error && <span role="alert">{field.error.message}</span>}
    </label>
  )
}

export default function MyForm() {
  return (
    <TheoForm
      action={actions.saveMemory}
      defaultValues={{ conversationId: 'default', content: '' }}
    >
      <input type="hidden" name="conversationId" value="default" readOnly />
      <MyField name="content" label="Memory content" />
      <button type="submit">Save</button>
    </TheoForm>
  )
}
```

The headless tier has **no `@usetheo/ui` dependency** — keeps the plugin usable in any React stack.

## Field-error adapter — `applyActionErrorsToForm`

`<TheoForm>` calls this internally on submit failure, but it's exported for advanced use:

```ts
import { applyActionErrorsToForm } from '@theokit/plugin-forms'
import { useForm } from 'react-hook-form'

const form = useForm()
// After a custom mutation:
applyActionErrorsToForm(form.setError, {
  'user.name': ['Required'],
  'items.0.qty': ['Must be >= 1'],
  '': ['Form-level error'], // root → 'root' per RHF convention
})
// → errors.user.name.message === 'Required'
// → errors.items[0].qty.message === 'Must be >= 1'
// → errors.root.message === 'Form-level error'
```

First message per field wins (HTML5 single `aria-describedby` convention). For multi-message rendering, read `formState.errors[name]` directly.

## Limitations (v0.1)

- **Requires JavaScript on the client.** No progressive-enhancement path in v0.1 — forms will not submit without JS. FormData wire (PE) is targeted for v0.2.
- **No file uploads in v0.1.** `multipart/form-data` deferred to v0.2.
- **No form arrays / wizards.** RHF `useFieldArray` works inside `<TheoForm>` but plugin sub-parts don't ship special UX for it.
- **`<TheoField>` (styled tier) throws at first render if `@usetheo/ui` is not installed**, not at module import. Use `useTheoField` (headless) when `@usetheo/ui` is not in the dep tree.
- **Async zod refinements (`.refine(async)`) are stripped client-side.** RHF cannot handle async resolvers cleanly; rely on the server's `ActionInputError` for those.
- **Shared-schema convention is required for `__zodSchema` auto-detection.** If you keep `input: z.object({...})` inline in `defineAction(...)`, `actions.X.__zodSchema` is `undefined` and `<TheoForm>` falls back to no client-side validation (server-side `ActionInputError` still hydrates).

## API surface

| Export                                      | Kind      | Notes                                                                   |
| ------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| `TheoForm`                                  | Component | Root + `Object.assign` sub-part `TheoForm.Field`                        |
| `TheoField`                                 | Component | Styled tier (peer `@usetheo/ui`); same as `TheoForm.Field`              |
| `useTheoField(name)`                        | Hook      | Headless tier — returns `{value, error, isInvalid, register, setValue}` |
| `useTheoFieldRegister()`                    | Hook      | Inside `<TheoField>` descendants — spread onto your input               |
| `useTheoFieldScope()`                       | Hook      | Inside `<TheoField>` descendants — full field state                     |
| `useTheoFormState()`                        | Hook      | Form-level state (isPending, isSuccess, isError, error, data, reset)    |
| `applyActionErrorsToForm(setError, fields)` | Function  | Pure adapter — maps `ActionInputError.fields` → RHF `setError` calls    |
| `TheoFormContext`                           | Context   | Exported for advanced override                                          |

Plus types: `TheoFormProps`, `TheoFormAction`, `TheoFieldProps`, `UseTheoFieldResult`, `TheoFormContextValue`, `TheoFormErrorLike`, `ActionInputErrorLike`, `SetErrorCallback`.

## Roadmap

- **v0.2** — FormData wire + progressive enhancement, file uploads, `useFieldArray` integration
- **v0.3** — Standard Schema adapter (valibot/arktype alongside zod)

## License

MIT — see [LICENSE](./LICENSE).
