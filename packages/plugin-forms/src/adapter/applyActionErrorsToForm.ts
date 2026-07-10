/**
 * Phase 2 / T2.1 — `applyActionErrorsToForm` adapter per plan p4-plugin-forms v1.1 ADR D3.
 *
 * Maps TheoKit G3 `ActionInputError.fields` (Record<string, string[]> with
 * dot-notation full-path keys, root → '') into RHF `setError(key, {type, message})`
 * calls. Root key '' maps to 'root' per RHF convention for form-level errors.
 *
 * Why this design (per ADR D3):
 *   - RHF's `setError` is the documented public API for async/server-side errors
 *   - RHF accepts flat dot-notation keys directly (internally builds nested FieldErrors)
 *   - TheoKit `buildFieldsMap` already produces the exact shape RHF accepts
 *   - First-message semantics matches HTML5 single-aria-describedby convention
 *
 * Consumers wanting all messages: subscribe to `formState.errors[name]` directly
 * and render via custom JSX (documented escape hatch in README cookbook 3).
 */

/**
 * Minimal callback signature matching RHF's `UseFormSetError`. We do NOT import
 * the type from `react-hook-form` to keep this adapter peer-dep-free at the type
 * level — consumers can pass any function matching this shape (real RHF setError
 * works; mocks for testing work; alternative form libs work).
 */
export type SetErrorCallback = (name: string, error: { type: string; message: string }) => void

/**
 * Shape of TheoKit's `ActionInputError.fields` after `buildFieldsMap` runs.
 * Root errors use empty-string key per the G3 contract at
 * `theokit/packages/theo/src/core/contracts/action-protocol.ts:165`.
 */
export type ActionInputErrorLike = Record<string, string[]>

/**
 * Map every entry of `fields` to a `setError(key, {type:'server', message})` call.
 * Root key '' → 'root' (RHF form-level convention). Multiple messages per key:
 * first message wins (HTML5 single-aria convention). Empty messages array: skip
 * the entry defensively (G3 shouldn't produce these but the contract allows it).
 *
 * The function is pure: no side effects beyond the supplied callback. Calling
 * with `fields = {}` is a no-op. Calling with `fields = undefined` would throw
 * — caller MUST guard the optional chain (e.g. `action.error?.fields ?? {}`).
 *
 * @param setError — RHF-compatible callback OR any function matching SetErrorCallback
 * @param fields — TheoKit ActionInputError.fields map (dot-notation full path, root '')
 */
export function applyActionErrorsToForm(
  setError: SetErrorCallback,
  fields: ActionInputErrorLike,
): void {
  for (const [key, messages] of Object.entries(fields)) {
    if (messages.length === 0) continue
    const rhfKey = key === '' ? 'root' : key
    setError(rhfKey, { type: 'server', message: messages[0]! })
  }
}
