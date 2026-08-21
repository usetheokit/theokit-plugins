/**
 * CRUD route handlers for artifact storage. Returns Web Standards
 * `Request → Response` functions the consumer wires via `defineRoute`
 * shims (same pattern as `@theokit/plugin-voice`).
 *
 * Endpoints:
 *
 *   GET    /artifacts                  — list (filter by ?session, ?kind, ?mode, ?offset, ?limit)
 *   POST   /artifacts                  — insert; auto-versions when version omitted
 *   GET    /artifacts/{id}             — latest version of `id`
 *   GET    /artifacts/{id}/versions    — every version of `id`
 *   GET    /artifacts/{id}/versions/{v}— specific version
 *   DELETE /artifacts/{id}             — drop all versions
 *   DELETE /artifacts/{id}/versions/{v}— drop one version
 *
 * The handlers do NOT route themselves — consumers split the request
 * by URL/method via their server framework and call the matching
 * handler. We avoid baking a tiny router inside the plugin (would
 * compete with the host framework's routing) but ship one
 * combined `handle()` for apps that want it.
 */

import {
  CanvasArtifactNotFoundError,
  CanvasArtifactSecurityError,
  CanvasArtifactValidationError,
  CanvasPluginError,
} from './errors.js'
import { ARTIFACT_KINDS, enforceArtifactSecurity, validateArtifact } from './schema.js'
import type { Artifact } from './schema.js'
import type { ArtifactListFilter, ArtifactStore } from './store.js'

export interface ArtifactRouteHandlerOptions {
  store: ArtifactStore
  /**
   * Hook that runs AFTER a successful insert. Use for SSE fan-out or
   * audit logging. Errors here are logged but do not fail the
   * response (the artifact is already persisted).
   */
  onAfterInsert?: (artifact: Artifact) => void | Promise<void>
}

/**
 * The five request handlers backing the artifact endpoints, returning web `Response` objects.
 *
 * They are handed back rather than mounted, because a plugin cannot register a route — `TheoApp`
 * offers hooks and request decoration and nothing else (#42), so the application owns the mounting
 * and therefore the paths, auth and rate limiting around them.
 */
export interface ArtifactRouteHandlers {
  list: (request: Request) => Promise<Response>
  create: (request: Request) => Promise<Response>
  getOne: (request: Request, params: { id: string; version?: number }) => Promise<Response>
  getVersions: (request: Request, params: { id: string }) => Promise<Response>
  remove: (request: Request, params: { id: string; version?: number }) => Promise<Response>
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  })
}

function jsonError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, { status })
}

function parseListFilter(url: URL): ArtifactListFilter | Response {
  const f: ArtifactListFilter = {}
  const session = url.searchParams.get('session')
  const kind = url.searchParams.get('kind')
  const mode = url.searchParams.get('mode')
  const offset = url.searchParams.get('offset')
  const limit = url.searchParams.get('limit')
  if (session !== null) f.sessionId = session
  if (kind !== null) {
    if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
      return jsonError(
        400,
        'INVALID_KIND',
        `Invalid artifact kind "${kind}". Valid kinds: ${ARTIFACT_KINDS.join(', ')}.`,
      )
    }
    f.kind = kind as ArtifactListFilter['kind']
  }
  if (mode === 'latest' || mode === 'all') f.mode = mode
  if (offset !== null) {
    const n = Number(offset)
    if (Number.isFinite(n) && n >= 0) f.offset = n
  }
  if (limit !== null) {
    const n = Number(limit)
    if (Number.isFinite(n) && n > 0 && n <= 1000) f.limit = n
  }
  return f
}

function isCanvasError(err: unknown): err is CanvasPluginError {
  return err instanceof CanvasPluginError
}

/**
 * Build the artifact endpoints over a given {@link ArtifactStore}.
 *
 * Returns handlers for the application to mount; it registers nothing itself, so auth, rate limiting
 * and the URL shape stay where the application can see them.
 */
export function createArtifactRouteHandlers(
  options: ArtifactRouteHandlerOptions,
): ArtifactRouteHandlers {
  const { store, onAfterInsert } = options

  return {
    async list(request) {
      try {
        const filterOrError = parseListFilter(new URL(request.url))
        if (filterOrError instanceof Response) return filterOrError
        const rows = await store.list(filterOrError)
        return jsonResponse({ artifacts: rows })
      } catch (err) {
        return errorToResponse(err)
      }
    },

    async create(request) {
      let payload: unknown
      try {
        payload = await request.json()
      } catch {
        return jsonError(400, 'INVALID_BODY', 'Body is not valid JSON.')
      }
      const candidate = (payload as { artifact?: unknown }).artifact ?? payload
      const validation = validateArtifact(candidate)
      if (!validation.ok) {
        return jsonError(400, 'INVALID_ARTIFACT', validation.error.message)
      }
      try {
        // Security gate (T1.1 / #176): the REST create path MUST reject
        // script-bearing artifacts, identical to the agent-tool path. Without
        // this, a direct POST persists stored-XSS payloads (OWASP A03). Kept
        // inside the same try so a non-security error still routes through
        // errorToResponse (500) rather than escaping unhandled.
        enforceArtifactSecurity(validation.artifact)
        let toInsert = validation.artifact
        // Auto-version: if the caller omitted `version` (always defaulted
        // to 1 by Zod) AND the id already has a row, bump to next.
        const existing = await store.get(toInsert.id)
        if (existing !== null && existing.version >= toInsert.version) {
          const next = await store.nextVersion(toInsert.id)
          toInsert = { ...toInsert, version: next }
        }
        const stored = await store.insert(toInsert)
        if (onAfterInsert !== undefined) {
          try {
            await onAfterInsert(stored)
          } catch (sideEffectErr) {
            console.error('[plugin-canvas] onAfterInsert side-effect failed:', {
              artifactId: stored.id,
              version: stored.version,
              error: sideEffectErr,
            })
          }
        }
        return jsonResponse({ artifact: stored }, { status: 201 })
      } catch (err) {
        if (err instanceof CanvasArtifactSecurityError) {
          return jsonError(400, err.reason, err.message)
        }
        return errorToResponse(err)
      }
    },

    async getOne(_request, params) {
      try {
        const row = await store.get(params.id, params.version)
        if (row === null) {
          return jsonError(404, 'NOT_FOUND', `Artifact "${params.id}" not found.`)
        }
        return jsonResponse({ artifact: row })
      } catch (err) {
        return errorToResponse(err)
      }
    },

    async getVersions(_request, params) {
      try {
        const versions = await store.getVersions(params.id)
        if (versions.length === 0) {
          return jsonError(404, 'NOT_FOUND', `Artifact "${params.id}" not found.`)
        }
        return jsonResponse({ versions })
      } catch (err) {
        return errorToResponse(err)
      }
    },

    async remove(_request, params) {
      try {
        await store.delete(params.id, params.version)
        return new Response(null, { status: 204 })
      } catch (err) {
        return errorToResponse(err)
      }
    },
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof CanvasArtifactNotFoundError) {
    return jsonError(404, 'NOT_FOUND', err.message)
  }
  if (err instanceof CanvasArtifactValidationError) {
    return jsonError(400, 'INVALID_ARTIFACT', err.message)
  }
  if (isCanvasError(err)) {
    console.error('[plugin-canvas] unhandled canvas error:', err)
    return jsonError(500, 'CANVAS_PLUGIN_ERROR', 'Internal Server Error')
  }
  console.error('[plugin-canvas] unhandled error:', err)
  return jsonError(500, 'INTERNAL', 'Internal Server Error')
}
