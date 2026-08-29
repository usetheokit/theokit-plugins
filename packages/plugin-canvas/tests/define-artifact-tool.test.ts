import { describe, expect, it, vi } from 'vitest'

import {
  CanvasArtifactSecurityError,
  CanvasArtifactValidationError,
  CanvasPluginError,
  defineArtifactTool,
} from '../src/index.js'
import type { Artifact } from '../src/schema.js'

const env = {
  id: 'a',
  title: 'T',
  version: 1,
  createdAt: '2026-05-29T00:00:00Z',
}

describe('defineArtifactTool', () => {
  it('returns a TheoTool-shaped config', () => {
    const tool = defineArtifactTool({ onPublish: (a) => Promise.resolve(a) })
    expect(typeof tool.name).toBe('string')
    expect(typeof tool.description).toBe('string')
    expect(tool.inputSchema).toBeDefined()
    expect(typeof tool.handler).toBe('function')
  })

  it('default name is publish_artifact', () => {
    const tool = defineArtifactTool({ onPublish: (a) => Promise.resolve(a) })
    expect(tool.name).toBe('publish_artifact')
  })

  it('handler validates + calls onPublish + returns { ok, artifactId, version, artifact }', async () => {
    const onPublish = vi.fn((a: Artifact) => Promise.resolve(a))
    const tool = defineArtifactTool({ onPublish })
    const result = await tool.handler({ ...env, kind: 'markdown', content: '# hi' })
    expect(result.ok).toBe(true)
    expect(result.artifactId).toBe('a')
    expect(result.version).toBe(1)
    expect(result.artifact.kind).toBe('markdown')
    expect(onPublish).toHaveBeenCalledOnce()
  })

  it('handler rejects invalid input with CanvasArtifactValidationError', async () => {
    const tool = defineArtifactTool({ onPublish: (a) => Promise.resolve(a) })
    await expect(tool.handler({ kind: 'markdown', content: 'x' })).rejects.toBeInstanceOf(
      CanvasArtifactValidationError,
    )
  })

  it('honors allowedKinds restriction', async () => {
    const tool = defineArtifactTool({
      allowedKinds: ['code', 'svg'],
      onPublish: (a) => Promise.resolve(a),
    })
    expect(tool.description).toMatch(/code, svg/)
    await expect(tool.handler({ ...env, kind: 'markdown', content: 'hi' })).rejects.toBeInstanceOf(
      CanvasArtifactSecurityError,
    )
  })

  it('throws CanvasPluginError when allowedKinds is empty', () => {
    expect(() =>
      defineArtifactTool({ allowedKinds: [], onPublish: (a) => Promise.resolve(a) }),
    ).toThrowError(CanvasPluginError)
  })

  it('injects ctx.sessionId when artifact.sessionId is missing', async () => {
    const onPublish = vi.fn((a: Artifact) => Promise.resolve(a))
    const tool = defineArtifactTool({ onPublish })
    await tool.handler({ ...env, kind: 'markdown', content: 'hi' }, { sessionId: 'sess-7' })
    expect(onPublish.mock.calls[0]?.[0].sessionId).toBe('sess-7')
  })

  it('does NOT overwrite an existing sessionId', async () => {
    const onPublish = vi.fn((a: Artifact) => Promise.resolve(a))
    const tool = defineArtifactTool({ onPublish })
    await tool.handler(
      { ...env, sessionId: 'preset', kind: 'markdown', content: 'hi' },
      { sessionId: 'sess-7' },
    )
    expect(onPublish.mock.calls[0]?.[0].sessionId).toBe('preset')
  })

  it('enforces security gate (rejects svg with <script>)', async () => {
    const tool = defineArtifactTool({ onPublish: (a) => Promise.resolve(a) })
    await expect(
      tool.handler({
        ...env,
        kind: 'svg',
        content: '<svg><script>bad()</script></svg>',
      }),
    ).rejects.toBeInstanceOf(CanvasArtifactSecurityError)
  })

  it('handler can be passed through defineCustomTool/defineAgentTool (structural test)', async () => {
    interface SdkTool {
      name: string
      description: string
      inputSchema: unknown
      handler: (input: unknown) => Promise<unknown>
    }
    function defineCustomTool(cfg: SdkTool): SdkTool {
      return cfg
    }
    const tool = defineCustomTool(defineArtifactTool({ onPublish: (a) => Promise.resolve(a) }))
    expect(tool.name).toBe('publish_artifact')
    const r = await tool.handler({ ...env, kind: 'markdown', content: 'hi' })
    expect(r).toMatchObject({ ok: true, artifactId: 'a' })
  })

  /**
   * Regression: theokit's `defineAgentTool` enforces "inputSchema MUST
   * be a ZodObject" so its JSON-Schema converter can produce a
   * `properties` record. Previously we exposed the raw discriminated
   * union — that crashes at registration time with "inputSchema must
   * be a ZodObject (z.object({...}))". The wrapper schema is
   * `z.object({ artifact: artifactSchema })`.
   *
   * The assertion is behavioural. It used to read `_def.typeName === 'ZodObject'`, which is zod 3's
   * internal shape — so moving this package to zod 4 turned the regression red while the contract it
   * guards still held (theokit's `isZodObject` accepts `def.type === 'object'` too). Asserting a
   * dependency's private field asserts that dependency's version, not our contract.
   *
   * `.shape` is what the guard is actually protecting: it exists on a ZodObject in both zod majors,
   * and it is precisely what theokit's JSON-Schema converter reads to build the `properties` record.
   * A discriminated union — the shape this regression exists to prevent returning to — has no
   * `.shape`, so the test still fails for the original reason (#191).
   *
   * Calling the real check would be stricter and is not available to us: `defineAgentTool` is
   * deliberately internal — ADR-0043 D1 removed the legacy `define*` FUNCTIONS from theokit's public
   * surface, keeping only their TYPES, and `tool()` is the public builder that delegates to it. So
   * there is no exported entry point that runs `isZodObject` on a schema we hand it.
   *
   * An earlier version of this comment claimed theokit's types exported the symbol while its runtime
   * did not (usetheokit/theokit#542, filed by me and closed as invalid). That was a miscount: the
   * three occurrences in the published `.d.ts` are all inside JSDoc, and `declare function
   * defineAgentTool` appears zero times. Corrected here rather than left standing, because a wrong
   * explanation in a comment outlives a wrong test — nobody executes it.
   */
  it('exposes inputSchema with a .shape the JSON-Schema converter can read', () => {
    const tool = defineArtifactTool({ onPublish: (a) => Promise.resolve(a) })
    const shape = (tool.inputSchema as { shape?: Record<string, unknown> }).shape
    expect(shape).toBeDefined()
    expect(Object.keys(shape ?? {})).toContain('artifact')
  })

  /**
   * Regression: the handler must accept BOTH the wrapped envelope
   * `{ artifact: {…} }` (what defineAgentTool passes through) AND the
   * flat artifact (what defineCustomTool / direct callers send).
   */
  it('handler accepts the wrapped { artifact } envelope', async () => {
    const onPublish = vi.fn((a: Artifact) => Promise.resolve(a))
    const tool = defineArtifactTool({ onPublish })
    const wrapped = {
      artifact: { ...env, kind: 'markdown' as const, content: '# wrapped' },
    }
    const r = await tool.handler(wrapped)
    expect(r.ok).toBe(true)
    expect(r.artifact.kind).toBe('markdown')
    expect(onPublish).toHaveBeenCalledOnce()
  })
})
