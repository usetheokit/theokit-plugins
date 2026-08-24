// Public barrel for @theokit/plugin-forms v0.1.0.

// Phase 2 — Adapter (pure function, no React deps)
export { applyActionErrorsToForm } from './adapter/applyActionErrorsToForm.js'
export type { ActionInputErrorLike, SetErrorCallback } from './adapter/applyActionErrorsToForm.js'
export { valuesToFormData } from './adapter/valuesToFormData.js'

// Phase 3 — Context + hooks
export { TheoFormContext, useTheoFormState } from './context/TheoFormContext.js'
export type { TheoFormContextValue, TheoFormErrorLike } from './context/TheoFormContext.js'
export { useTheoField } from './hooks/useTheoField.js'
export type { UseTheoFieldResult } from './hooks/useTheoField.js'

// Phase 4 — Components (styled tier + scope hooks)
export { TheoForm } from './components/TheoForm.js'
export type { TheoFormProps, TheoFormAction } from './components/TheoForm.js'
export { TheoField, useTheoFieldRegister, useTheoFieldScope } from './components/TheoField.js'
export type { TheoFieldProps } from './components/TheoField.js'
