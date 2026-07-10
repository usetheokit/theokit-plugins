/**
 * Per-action handler functions for the canvas reducer.
 *
 * Extracted from the monolithic switch/case in `use-canvas.ts` (T5.1)
 * to reduce cyclomatic complexity. Each handler is a pure function:
 *   (state, action?) → newState
 *
 * Behavior is UNCHANGED — this is a structural refactor only.
 */
import type { CanvasPluginError } from '../errors.js'
import type { Artifact } from '../schema.js'

// ───── State + action types (canonical definitions) ─────

export interface CanvasState {
  history: Map<string, Artifact[]>
  pointer: { id: string; version: number } | null
  open: boolean
  error: CanvasPluginError | null
}

export type CanvasAction =
  | { type: 'show'; artifact: Artifact; autoOpen: boolean }
  | { type: 'select-existing'; id: string; version: number }
  | { type: 'hide' }
  | { type: 'set-open'; open: boolean }
  | { type: 'error'; error: CanvasPluginError }
  | { type: 'clear-error' }
  | { type: 'remove'; id: string; version?: number }

// ───── Handlers ─────

export function handleShow(
  state: CanvasState,
  action: Extract<CanvasAction, { type: 'show' }>,
): CanvasState {
  const next = new Map(state.history)
  const existing = next.get(action.artifact.id) ?? []
  const filtered = existing.filter((a) => a.version !== action.artifact.version)
  const merged = [...filtered, action.artifact].sort((a, b) => a.version - b.version)
  next.set(action.artifact.id, merged)
  return {
    ...state,
    history: next,
    pointer: { id: action.artifact.id, version: action.artifact.version },
    open: action.autoOpen ? true : state.open,
    error: null,
  }
}

export function handleSelectExisting(
  state: CanvasState,
  action: Extract<CanvasAction, { type: 'select-existing' }>,
): CanvasState {
  return {
    ...state,
    pointer: { id: action.id, version: action.version },
  }
}

export function handleHide(state: CanvasState): CanvasState {
  return { ...state, open: false }
}

export function handleSetOpen(
  state: CanvasState,
  action: Extract<CanvasAction, { type: 'set-open' }>,
): CanvasState {
  return { ...state, open: action.open }
}

export function handleError(
  state: CanvasState,
  action: Extract<CanvasAction, { type: 'error' }>,
): CanvasState {
  return { ...state, error: action.error }
}

export function handleClearError(state: CanvasState): CanvasState {
  return { ...state, error: null }
}

export function handleRemove(
  state: CanvasState,
  action: Extract<CanvasAction, { type: 'remove' }>,
): CanvasState {
  const next = new Map(state.history)
  const existing = next.get(action.id)
  if (existing === undefined) return state

  const remaining =
    action.version === undefined ? [] : existing.filter((a) => a.version !== action.version)

  if (remaining.length === 0) next.delete(action.id)
  else next.set(action.id, remaining)

  const pointer = resolvePointerAfterRemove(state.pointer, action.id, remaining)
  return { ...state, history: next, pointer }
}

// ───── Internal helpers ─────

function resolvePointerAfterRemove(
  currentPointer: CanvasState['pointer'],
  removedId: string,
  remaining: Artifact[],
): CanvasState['pointer'] {
  if (currentPointer === null || currentPointer.id !== removedId) {
    return currentPointer
  }
  if (remaining.length > 0) {
    return { id: removedId, version: remaining[remaining.length - 1]?.version ?? 1 }
  }
  return null
}

// ───── Reducer (thin dispatcher) ─────

export function reducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'show':
      return handleShow(state, action)
    case 'select-existing':
      return handleSelectExisting(state, action)
    case 'hide':
      return handleHide(state)
    case 'set-open':
      return handleSetOpen(state, action)
    case 'error':
      return handleError(state, action)
    case 'clear-error':
      return handleClearError(state)
    case 'remove':
      return handleRemove(state, action)
    default: {
      const exhaustive: never = action
      throw new Error(`Unhandled action: ${(exhaustive as { type: string }).type}`)
    }
  }
}
