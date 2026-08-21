/**
 * `useCanvas(options)` — React state machine for the artifact panel.
 *
 * Responsibilities:
 *   - track the currently-displayed artifact (`current`)
 *   - track every version of `current.id` so the rail can navigate
 *   - track the entire session history (latest version of each id)
 *   - own the controlled `open` state for `<CanvasPanel>`
 *   - publish new artifacts to the backend store (POST) — optimistic
 *     local insert + rollback on failure
 *   - fork: publish a new artifact with `id` derived from the source
 *     so it lives on a separate history line
 *   - auto-open the panel on first artifact when `autoOpen` is true
 *
 * Not in scope (T4.5 / Wave 3):
 *   - SSE subscription is wired in T4.8 (dogfood layer) — too coupled to
 *     theokit's SSE shape to live in the framework-agnostic plugin
 *
 * State is a `useReducer` so each transition is observable + testable
 * in isolation (vs scattered `useState` calls that hide ordering).
 */
import { useCallback, useMemo, useReducer, useRef } from 'react'

import { CanvasArtifactValidationError, CanvasPluginError } from '../errors.js'
import { type Artifact, validateArtifact } from '../schema.js'
import { reducer, type CanvasState } from './canvas-reducer-handlers.js'

// ───── Public hook surface ─────

/**
 * Options for {@link useCanvas}.
 *
 * `endpoint` is optional and its absence is a mode, not a defect: without it `publish()` updates
 * local state only, which is what a preview-only or ephemeral canvas wants. `csrfHeader` defaults to
 * TheoKit's strict-mode pair and takes `null` to opt out explicitly rather than by omission.
 */
export interface UseCanvasOptions {
  /**
   * Endpoint that accepts `POST` of `{ artifact }` and returns the
   * persisted (server-versioned) artifact. Optional — when omitted,
   * `publish()` skips the network round-trip and only updates local
   * state (useful for ephemeral / preview-only flows).
   */
  endpoint?: string
  /**
   * CSRF header pair attached to every publish request. Default
   * matches TheoKit strict mode (`X-Theo-Action: 1`). Pass `null` to
   * disable.
   */
  csrfHeader?: { name: string; value: string } | null
  /** Auto-open the panel when the first artifact arrives. Default true. */
  autoOpen?: boolean
  /** Test seam for fetch. */
  fetchImpl?: typeof fetch
  /** Seed the history with pre-loaded artifacts (e.g. server-side hydration). */
  initialArtifacts?: readonly Artifact[]
}

/**
 * What {@link useCanvas} returns: the artifact on screen, its versions, the session history, panel
 * open state, and the last error.
 *
 * `error` is a value rather than a thrown exception because a failed publish is an ordinary thing
 * for a UI to display, and throwing it would take down the surrounding component tree.
 */
export interface UseCanvasState {
  /** The currently displayed artifact (latest version selected). */
  current: Artifact | null
  /** All versions of the current artifact id, ascending. */
  versions: readonly Artifact[]
  /** Latest version of EVERY artifact id in the session, sorted by createdAt desc. */
  history: readonly Artifact[]
  /** Controlled `open` state for `<CanvasPanel>`. */
  open: boolean
  /** Last publish/fork error, null when none. */
  error: CanvasPluginError | null

  show: (artifact: Artifact) => void
  selectVersion: (id: string, version: number) => void
  hide: () => void
  setOpen: (open: boolean) => void
  clearError: () => void
  publish: (artifact: Artifact) => Promise<Artifact>
  fork: (source: Artifact, overrides: Partial<Artifact>) => Promise<Artifact>
  remove: (id: string, version?: number) => void
}

const DEFAULT_CSRF_HEADER = { name: 'X-Theo-Action', value: '1' }

/**
 * Drive a canvas from React: hold the artifact history, publish new ones, select versions.
 *
 * Versioning is the server's decision — `publish()` sends the artifact and adopts the persisted,
 * server-versioned copy, so two clients publishing at once cannot both believe they wrote version 3.
 */
export function useCanvas(options: UseCanvasOptions = {}): UseCanvasState {
  const { endpoint, autoOpen = true, fetchImpl, initialArtifacts } = options
  // Headers: `undefined` → use default; `null` → disabled; object → pass-through.
  const csrfHeader: { name: string; value: string } | null =
    options.csrfHeader === undefined ? DEFAULT_CSRF_HEADER : options.csrfHeader

  const initialState = useMemo<CanvasState>(() => {
    const history = new Map<string, Artifact[]>()
    if (initialArtifacts !== undefined) {
      for (const a of initialArtifacts) {
        const existing = history.get(a.id) ?? []
        existing.push(a)
        history.set(
          a.id,
          existing.sort((x, y) => x.version - y.version),
        )
      }
    }
    return { history, pointer: null, open: false, error: null }
    // initialArtifacts is captured once on mount by design — the hook
    // is for live state, not for swapping seeds at runtime.
  }, [])

  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state

  const show = useCallback(
    (artifact: Artifact) => {
      dispatch({ type: 'show', artifact, autoOpen })
    },
    [autoOpen],
  )

  const selectVersion = useCallback((id: string, version: number) => {
    dispatch({ type: 'select-existing', id, version })
  }, [])

  const hide = useCallback(() => dispatch({ type: 'hide' }), [])
  const setOpen = useCallback(
    (nextOpen: boolean) => dispatch({ type: 'set-open', open: nextOpen }),
    [],
  )
  const clearError = useCallback(() => dispatch({ type: 'clear-error' }), [])
  const remove = useCallback((id: string, version?: number) => {
    dispatch({ type: 'remove', id, version })
  }, [])

  const publish = useCallback(
    async (artifact: Artifact): Promise<Artifact> => {
      const validation = validateArtifact(artifact)
      if (!validation.ok) {
        dispatch({ type: 'error', error: validation.error })
        throw validation.error
      }
      // Optimistic local insert — the panel renders instantly even if
      // the POST is still flying. On failure we roll back.
      dispatch({ type: 'show', artifact: validation.artifact, autoOpen })

      if (endpoint === undefined) return validation.artifact

      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (csrfHeader !== null) headers[csrfHeader.name] = csrfHeader.value
      try {
        const res = await (fetchImpl ?? globalThis.fetch)(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(validation.artifact),
        })
        if (!res.ok) {
          dispatch({
            type: 'remove',
            id: validation.artifact.id,
            version: validation.artifact.version,
          })
          const text = await res.text().catch(() => '')
          const err = new CanvasPluginError(
            `Publish endpoint returned ${res.status}: ${text.slice(0, 200)}`,
          )
          dispatch({ type: 'error', error: err })
          throw err
        }
        const persisted = (await res.json()) as { artifact?: Artifact } | Artifact
        const out =
          'artifact' in persisted && persisted.artifact !== undefined
            ? persisted.artifact
            : (persisted as Artifact)
        const revalidate = validateArtifact(out)
        if (!revalidate.ok) {
          dispatch({ type: 'error', error: revalidate.error })
          throw revalidate.error
        }
        // Replace the optimistic entry with the server's canonical shape
        // (server may have re-numbered the version, mutated createdAt, …).
        dispatch({ type: 'show', artifact: revalidate.artifact, autoOpen: false })
        return revalidate.artifact
      } catch (err) {
        if (err instanceof CanvasPluginError || err instanceof CanvasArtifactValidationError) {
          throw err
        }
        const wrapped = new CanvasPluginError(
          `Publish network failure: ${err instanceof Error ? err.message : 'unknown'}`,
          { cause: err },
        )
        dispatch({ type: 'error', error: wrapped })
        throw wrapped
      }
    },
    [autoOpen, csrfHeader, endpoint, fetchImpl],
  )

  const fork = useCallback(
    async (source: Artifact, overrides: Partial<Artifact>): Promise<Artifact> => {
      const next = {
        ...source,
        ...overrides,
        // Fork lands on a new id by default so the version rail of the
        // source stays untouched. Callers can pin `id` in overrides to
        // create a new version of the SAME artifact instead.
        id: overrides.id ?? `${source.id}-fork-${Date.now().toString(36)}`,
        version: overrides.version ?? 1,
        createdAt: overrides.createdAt ?? new Date().toISOString(),
      } as Artifact
      return publish(next)
    },
    [publish],
  )

  // Derived selectors.
  const versions = useMemo<readonly Artifact[]>(() => {
    if (state.pointer === null) return []
    return state.history.get(state.pointer.id) ?? []
  }, [state.pointer, state.history])

  const current = useMemo<Artifact | null>(() => {
    if (state.pointer === null) return null
    const versionsForId = state.history.get(state.pointer.id)
    if (versionsForId === undefined) return null
    return (
      versionsForId.find((a) => a.version === state.pointer?.version) ??
      versionsForId[versionsForId.length - 1] ??
      null
    )
  }, [state.pointer, state.history])

  const history = useMemo<readonly Artifact[]>(() => {
    const out: Artifact[] = []
    for (const versions of state.history.values()) {
      const latest = versions[versions.length - 1]
      if (latest !== undefined) out.push(latest)
    }
    return out.sort((a, b) => {
      const ay = typeof a.createdAt === 'string' ? Date.parse(a.createdAt) : a.createdAt
      const by = typeof b.createdAt === 'string' ? Date.parse(b.createdAt) : b.createdAt
      return by - ay
    })
  }, [state.history])

  return {
    current,
    versions,
    history,
    open: state.open,
    error: state.error,
    show,
    selectVersion,
    hide,
    setOpen,
    clearError,
    publish,
    fork,
    remove,
  }
}
