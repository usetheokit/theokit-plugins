# @theokit/plugin-forms

Declarative form binding for TheoKit. Glues `zod` + `react-hook-form` + `useAction` (from `@theokit/react`) into a single `<TheoForm action={actions.X}>` component. Field-level errors from `ActionInputError.fields` map straight into the form via a small adapter; pending state flows through Context.

> **Status:** v0.1.0 (early). Requires JavaScript on the client (no progressive enhancement in v0.1 — see Limitations).

## Install

```bash
pnpm add @theokit/plugin-forms react-hook-form @hookform/resolvers zod@^4
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

### `zod@^4` is required, and npm refuses without it

Pin zod 4 explicitly. `npm install @theokit/plugin-forms` on its own **fails** with
`ERESOLVE`, and the reason is a zod major split between two optional-peer chains neither
this package nor npm can reconcile:

| Chain                                                                   | Requires      |
| ----------------------------------------------------------------------- | ------------- |
| `@hookform/resolvers@5` → `@typeschema/main` → `@typeschema/zod@0.14.0` | `zod@^3.23.8` |
| `@theokit/react@1.1.0` → `@theokit/sdk@1.9.0`                           | `zod@^4.0.0`  |

npm resolves `zod` to the 3.x ceiling of the first chain and then refuses the second. Both
sides are _optional_ peers and it refuses anyway — which is why `--legacy-peer-deps` works
and pnpm only warns. Naming `zod@^4` at the root resolves it.

The underlying cause is outside this package: `@theokit/react` has a single published
version pinned to the `@theokit/sdk@1.x` line, three majors behind current. Tracked in
[#64](https://github.com/usetheokit/theokit-plugins/issues/64); this note goes away when a
`@theokit/react` on the current SDK line ships.

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

<!-- doc-example: needs="./schemas/save-memory.js" -->

```ts
// server/actions/save-memory.ts
import { action } from 'theokit/server'
import { schema } from './schemas/save-memory.js'

export const saveMemory = action()
  .input(schema)
  .handler(async ({ input }) => {
    // persist input.content under input.conversationId
    return { id: 'mem_...' }
  })
  .build()
```

The TheoKit Vite plugin detects the convention and exposes the schema at runtime as `actions.saveMemory.__zodSchema`. `<TheoForm>` reads it to drive RHF's `zodResolver` — no client re-declaration.

## Cookbook 1 — basic form with `<TheoForm.Field>` (styled tier)

<!-- doc-example: needs="@theo/actions" -->

```tsx
'use client'
import { actions } from '@theo/actions'
import { TheoForm, TheoField, useTheoFieldRegister, useTheoFieldScope } from '@theokit/plugin-forms'
import { FormField, Input, Button } from '@usetheo/ui'

// `FormField.Control` clones its DIRECT child to inject `id`, `aria-invalid` and
// `aria-describedby`. So the direct child has to be the real `<Input>`: a component of
// your own in that slot receives those props and drops them, leaving the label pointing
// at an id nothing has and the error announced to nobody (#105). Keep `FormField.Control`
// INSIDE the component that calls the hook.
function ControlForCurrentField() {
  const register = useTheoFieldRegister()
  return (
    <FormField.Control>
      <Input {...register} placeholder="Type something..." />
    </FormField.Control>
  )
}

// `FormField.Error` renders its CHILDREN — it does not read the message from anywhere. Left
// self-closing it shows an empty alert: the field goes `aria-invalid`, the icon appears, and
// the reason the server gave is dropped (#106). `useTheoFieldScope()` is exported for this.
function ErrorForCurrentField() {
  const { error } = useTheoFieldScope()
  return <FormField.Error>{error?.message}</FormField.Error>
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
        <ControlForCurrentField />
        <ErrorForCurrentField />
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

<!-- doc-example: needs="@theo/actions" -->

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

## File uploads

Files work. `<TheoField>` renders no input of its own, so a file control is just an input that
spreads `useTheoFieldRegister()`:

<!-- doc-example: needs="./my-action.js" -->

```tsx
import * as React from 'react'
import { z } from 'zod'
import { TheoField, TheoForm, useTheoFieldRegister } from '@theokit/plugin-forms'

import { upload } from './my-action.js'

const schema = z.object({
  title: z.string(),
  docs: z.array(z.instanceof(File)),
})

function FileControl(): React.JSX.Element {
  const register = useTheoFieldRegister()
  return <input type="file" multiple {...register} />
}

export function UploadForm(): React.JSX.Element {
  return (
    <TheoForm action={upload as never} schema={schema as never} encType="multipart/form-data">
      <TheoField name="docs">
        <FileControl />
      </TheoField>
    </TheoForm>
  )
}
```

Three things are worth knowing, because each is a thing you would otherwise get wrong once:

- **`z.array(z.instanceof(File))`, not `z.instanceof(File)`** — even for a single file. A registered
  file input holds a `FileList`, which this package normalises to `File[]` before validation. A
  single-file field is a one-element array on both sides.
- **`encType="multipart/form-data"` is required and is not inferred.** Without it the values go as a
  plain object and `JSON.stringify` keeps the file's name and drops its bytes — your server stores
  an empty file and nothing errors. Conversion is not inferred from the values because an action
  whose input is an object on one submit and a `FormData` on the next cannot be typed.
- **Your action must declare `accept: 'form'` server-side.** That is where the body is parsed, and
  this package cannot see it. Without it the server reads JSON and every field arrives empty.

The size limits (`maxFileSize`, `maxFiles`, total body) are the server's, and it enforces them while
parsing — so a rejected upload is rejected _after_ the bytes crossed the network. The rejection
reaches the field like any other server error.

## Limitations (v0.1)

- **Requires JavaScript on the client.** No progressive-enhancement path in v0.1 — forms will not submit without JS. FormData wire (PE) is targeted for v0.2.
- **A multipart scalar array collapses to its last element.** `tags: ['a','b']` arrives as `['b']`.
  The cause is in the framework's body parser, upstream of anything this package controls, and
  there is no client-side fix. Arrays of **files** are unaffected. Pinned by a test here so the day
  it is fixed, we find out.
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
