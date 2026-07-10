/**
 * T4.7 — CRUD route handlers (Web Standards Request → Response).
 */
import { describe, expect, it, vi } from 'vitest'

import { createArtifactRouteHandlers, createInMemoryArtifactStore } from '../src/index.js'
import type { Artifact } from '../src/schema.js'

const env = {
  id: 'a1',
  title: 'T',
  version: 1,
  createdAt: '2026-05-29T00:00:00Z',
}

function md(overrides: Partial<Artifact> = {}): Artifact {
  return { ...env, kind: 'markdown', content: '#', ...overrides } as Artifact
}

function jsonRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createArtifactRouteHandlers', () => {
  it('POST /artifacts creates + returns 201 { artifact }', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.create(jsonRequest('POST', 'http://x/artifacts', md()))
    expect(res.status).toBe(201)
    const json = (await res.json()) as { artifact?: Artifact }
    expect(json.artifact?.id).toBe('a1')
  })

  it('POST accepts a wrapped { artifact } payload OR a bare artifact', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.create(
      jsonRequest('POST', 'http://x/artifacts', { artifact: md({ id: 'wrapped' }) }),
    )
    expect(res.status).toBe(201)
    expect(((await res.json()) as { artifact: Artifact }).artifact.id).toBe('wrapped')
  })

  it('POST auto-bumps version when re-publishing the same id', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    await handlers.create(jsonRequest('POST', 'http://x/artifacts', md({ version: 1 })))
    const second = await handlers.create(
      jsonRequest('POST', 'http://x/artifacts', md({ version: 1 })),
    )
    expect(second.status).toBe(201)
    const json = (await second.json()) as { artifact: Artifact }
    expect(json.artifact.version).toBe(2)
  })

  it('POST rejects invalid body with 400 INVALID_BODY', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.create(
      new Request('http://x/artifacts', {
        method: 'POST',
        body: '{not json',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/INVALID_BODY/)
  })

  it('POST rejects invalid artifact with 400 INVALID_ARTIFACT', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.create(
      jsonRequest('POST', 'http://x/artifacts', { kind: 'markdown', content: 'x' }),
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/INVALID_ARTIFACT/)
  })

  // T1.1 (#176) — the REST create path MUST enforce artifact security, like the
  // agent-tool path. Before the fix these script-bearing artifacts persist (201).
  it('POST rejects a script-bearing SVG with 400 (security gate)', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.create(
      jsonRequest(
        'POST',
        'http://x/artifacts',
        md({
          kind: 'svg',
          content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        }),
      ),
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/svg-script-tag|SECURITY/)
    expect(await store.get('a1')).toBeNull()
  })

  it('POST rejects an HTML srcdoc with a meta-refresh with 400 (security gate)', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.create(
      jsonRequest('POST', 'http://x/artifacts', {
        id: 'h1',
        title: 'T',
        version: 1,
        createdAt: '2026-05-29T00:00:00Z',
        kind: 'html',
        srcdoc: '<!doctype html><meta http-equiv="refresh" content="0;url=https://evil.example">',
      }),
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/html-meta-refresh|SECURITY/)
  })

  it('POST still accepts a benign code artifact with 201 (no over-blocking)', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.create(
      jsonRequest(
        'POST',
        'http://x/artifacts',
        md({ kind: 'code', content: 'const x = 1', language: 'ts' }),
      ),
    )
    expect(res.status).toBe(201)
  })

  it('POST fires onAfterInsert with the stored artifact', async () => {
    const store = createInMemoryArtifactStore()
    const onAfterInsert = vi.fn<(artifact: Artifact) => void>()
    const handlers = createArtifactRouteHandlers({ store, onAfterInsert })
    await handlers.create(jsonRequest('POST', 'http://x/artifacts', md()))
    expect(onAfterInsert).toHaveBeenCalledOnce()
    expect(onAfterInsert.mock.calls[0]?.[0].id).toBe('a1')
  })

  it('GET /artifacts/{id} returns latest version', async () => {
    const store = createInMemoryArtifactStore()
    await store.insert(md({ version: 1 }))
    await store.insert(md({ version: 2 }))
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.getOne(new Request('http://x/artifacts/a1', { method: 'GET' }), {
      id: 'a1',
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { artifact: Artifact }
    expect(json.artifact.version).toBe(2)
  })

  it('GET /artifacts/{id} returns 404 when missing', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.getOne(new Request('http://x/artifacts/nope'), { id: 'nope' })
    expect(res.status).toBe(404)
  })

  it('GET versions returns the array', async () => {
    const store = createInMemoryArtifactStore()
    await store.insert(md({ version: 1 }))
    await store.insert(md({ version: 2 }))
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.getVersions(new Request('http://x/artifacts/a1/versions'), {
      id: 'a1',
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { versions: Artifact[] }
    expect(json.versions.map((v) => v.version)).toEqual([1, 2])
  })

  it('GET /artifacts lists + supports filter query params', async () => {
    const store = createInMemoryArtifactStore()
    await store.insert(md({ id: 'a', sessionId: 's1' }))
    await store.insert(md({ id: 'b', sessionId: 's2' }))
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.list(new Request('http://x/artifacts?session=s1', { method: 'GET' }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { artifacts: Artifact[] }
    expect(json.artifacts.map((a) => a.id)).toEqual(['a'])
  })

  it('DELETE /artifacts/{id} returns 204', async () => {
    const store = createInMemoryArtifactStore()
    await store.insert(md())
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.remove(new Request('http://x/artifacts/a1', { method: 'DELETE' }), {
      id: 'a1',
    })
    expect(res.status).toBe(204)
    expect(await store.get('a1')).toBeNull()
  })

  it('GET /artifacts?kind=bogus returns 400 INVALID_KIND', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.list(new Request('http://x/artifacts?kind=bogus', { method: 'GET' }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { code: string; message: string } }
    expect(json.error.code).toBe('INVALID_KIND')
    expect(json.error.message).toMatch(/bogus/)
  })

  it('GET /artifacts?kind=markdown passes valid kind filter', async () => {
    const store = createInMemoryArtifactStore()
    await store.insert(md({ id: 'a' }))
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.list(
      new Request('http://x/artifacts?kind=markdown', { method: 'GET' }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { artifacts: Artifact[] }
    expect(json.artifacts).toHaveLength(1)
  })

  it('DELETE returns 404 when not found', async () => {
    const store = createInMemoryArtifactStore()
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.remove(
      new Request('http://x/artifacts/nope', { method: 'DELETE' }),
      {
        id: 'nope',
        version: 1,
      },
    )
    expect(res.status).toBe(404)
  })

  it('T1.4: 500 error does not leak internal message', async () => {
    const store = createInMemoryArtifactStore()
    // Override list to throw an internal error
    store.list = () => {
      throw new Error('SQLITE_ERROR: no such table')
    }
    const handlers = createArtifactRouteHandlers({ store })
    const res = await handlers.list(new Request('http://x/artifacts', { method: 'GET' }))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('Internal Server Error')
    expect(text).not.toContain('SQLITE_ERROR')
  })

  it('T3.1: onAfterInsert error is logged but response is still 201', async () => {
    const store = createInMemoryArtifactStore()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* intentionally empty — silence the expected error log in this test */
    })
    const handlers = createArtifactRouteHandlers({
      store,
      onAfterInsert: () => {
        throw new Error('side-effect boom')
      },
    })
    const res = await handlers.create(jsonRequest('POST', 'http://x/artifacts', md()))
    expect(res.status).toBe(201)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('onAfterInsert'),
      expect.objectContaining({
        error: expect.any(Error) as unknown,
      }),
    )
    consoleSpy.mockRestore()
  })
})
