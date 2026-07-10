/**
 * `defineArtifactTool` — produces an SDK-shaped custom tool the agent
 * can call to publish an artifact into the canvas surface.
 *
 * Why a structural shape (no hard dep on `@theokit/sdk` or `theokit/server`):
 * the plugin must work for both SDK consumers and TheoKit apps without
 * forcing the wrong peer dep range on either side. The returned object
 * matches both `defineCustomTool(...)` and `defineAgentTool(...)` shape
 * — apps pass it through their preferred constructor.
 *
 *   ```ts
 *   import { defineArtifactTool } from '@theokit/plugin-canvas'
 *   import { defineAgentTool } from 'theokit/server'
 *
 *   const publishArtifact = defineAgentTool(
 *     defineArtifactTool({
 *       onPublish: async (artifact) => {
 *         const stored = await store.insert(artifact)
 *         await sse.emit({ type: 'artifact', artifact: stored })
 *         return stored
 *       },
 *     }),
 *   )
 *   ```
 *
 * The handler is a thin wrapper around the consumer's `onPublish`
 * persistence callback. It runs `validateArtifact` + `enforceArtifactSecurity`
 * at the boundary so the consumer never has to re-implement those
 * checks downstream. Errors surface as typed `CanvasPluginError`
 * subclasses; the SDK's tool runtime can map them to a tool_error.
 */

import { z } from 'zod'

import {
  CanvasArtifactValidationError,
  CanvasArtifactSecurityError,
  CanvasPluginError,
} from './errors.js'
import {
  ARTIFACT_KINDS,
  artifactSchema,
  enforceArtifactSecurity,
  type Artifact,
  type ArtifactKind,
} from './schema.js'

export interface ArtifactToolHandlerContext {
  /** Stable id derived from the chat session, if available. */
  sessionId?: string
  /** Opaque pass-through carried by the SDK / TheoKit tool runtime. */
  ctx?: unknown
}

export interface ArtifactToolResult {
  ok: true
  artifactId: string
  version: number
  /**
   * The persisted artifact — agents often need to reference its id /
   * version in subsequent reasoning. Keeping it inline avoids a second
   * tool call to fetch.
   */
  artifact: Artifact
}

export interface DefineArtifactToolOptions {
  /**
   * Closed allow-list of kinds. When omitted, all 9 kinds are
   * accepted. Apps that restrict this should also update their agent
   * prompt so the model knows which kinds are usable.
   */
  allowedKinds?: readonly ArtifactKind[]
  /**
   * Persistence side-effect. Must throw on storage failure so the
   * agent sees a tool_error and can recover.
   */
  onPublish: (artifact: Artifact, ctx: ArtifactToolHandlerContext) => Promise<Artifact>
  /** Override the tool name. Default `publish_artifact`. */
  name?: string
  /** Override the tool description. Default lists the allowed kinds. */
  description?: string
}

export interface ArtifactToolConfig {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  handler: (input: unknown, ctx?: ArtifactToolHandlerContext) => Promise<ArtifactToolResult>
}

const DEFAULT_NAME = 'publish_artifact'

/**
 * Accepts both the wrapped envelope `{ artifact: {…} }` (required by
 * theokit's `defineAgentTool` ZodObject contract) and a flat artifact
 * (what apps wiring through `defineCustomTool` directly may send). The
 * unwrap is intentionally narrow: only `{ artifact: … }` is unwrapped —
 * any other top-level shape passes through unchanged so schema
 * validation catches structural mistakes downstream.
 */
function extractArtifactCandidate(input: unknown): unknown {
  if (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    'artifact' in input &&
    // The flat-artifact path also has a `kind` discriminator; if both
    // exist we trust the wrapped form (since `artifact` is the
    // canonical envelope key).
    typeof (input as { artifact?: unknown }).artifact === 'object'
  ) {
    return input.artifact
  }
  return input
}

function buildDescription(allowed: readonly ArtifactKind[]): string {
  return [
    'Publish a rendered artifact into the side canvas surface so the user can see it inline.',
    `Allowed kinds: ${allowed.join(', ')}.`,
    'Always provide a short human-readable title. The envelope `id` should be stable across versions of the same artifact (re-publishing the same id increments version).',
  ].join(' ')
}

export function defineArtifactTool(options: DefineArtifactToolOptions): ArtifactToolConfig {
  const allowed = options.allowedKinds ?? ARTIFACT_KINDS
  if (allowed.length === 0) {
    throw new CanvasPluginError(
      'defineArtifactTool: allowedKinds was empty — at least one kind is required.',
    )
  }
  // Wrap the discriminated artifact union inside a `z.object({ artifact })`
  // envelope. theokit's `defineAgentTool` enforces "inputSchema must be a
  // ZodObject" so the SDK's JSON-Schema conversion can produce a
  // properties record. The handler accepts BOTH the wrapped form
  // (`{ artifact: {…} }`) AND a flat artifact directly — apps that wire
  // through the SDK's `defineCustomTool` may send either shape.
  const inputSchema = z.object({
    artifact: artifactSchema,
  })

  const description = options.description ?? buildDescription(allowed)

  const handler = async (
    input: unknown,
    ctx: ArtifactToolHandlerContext = {},
  ): Promise<ArtifactToolResult> => {
    const candidate = extractArtifactCandidate(input)
    const parsed = artifactSchema.safeParse(candidate)
    if (!parsed.success) {
      throw new CanvasArtifactValidationError(
        'Artifact rejected by schema',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        { cause: parsed.error },
      )
    }
    let artifact = parsed.data
    if (!allowed.includes(artifact.kind)) {
      throw new CanvasArtifactSecurityError(
        `Kind "${artifact.kind}" is not in the tool's allowed set.`,
        'kind-not-allowed',
      )
    }
    // T1.5 (#181): call directly — a security failure propagates to the SDK
    // runtime as a tool error on its own; the old try/catch only re-threw.
    enforceArtifactSecurity(artifact)
    if (ctx.sessionId !== undefined && artifact.sessionId === undefined) {
      artifact = { ...artifact, sessionId: ctx.sessionId }
    }
    const stored = await options.onPublish(artifact, ctx)
    return {
      ok: true,
      artifactId: stored.id,
      version: stored.version,
      artifact: stored,
    }
  }

  return {
    name: options.name ?? DEFAULT_NAME,
    description,
    inputSchema,
    handler,
  }
}
