import 'reflect-metadata'

import { CONTROLLER_PREFIX, Controller, SetMetadata, getMeta } from '@theokit/http'
import { describe, expect, it } from 'vitest'

import { createArtifactRouteHandlers } from '../src/route-handlers.js'
import { ArtifactsControllerBase } from '../src/server/artifacts-controller.js'
import { createInMemoryArtifactStore } from '../src/store.js'
import type { ArtifactRouteHandlers } from '../src/route-handlers.js'

/**
 * The plugin ships BEHAVIOUR; the consuming app supplies path and policy.
 *
 * `createArtifactRouteHandlers` hands back functions the app must mount by hand, so every consumer
 * rewrites the same wiring and each one decides afresh what the URL is, whether a session is
 * required, and how the request body reaches the handler. That is a plugin open for modification:
 * changing what an artifact route does means editing every app that mounts one.
 *
 * A base controller inverts it (SOLID, open/closed). The plugin declares the verbs and delegates to
 * the handlers it already has — the XSS gate, the auto-versioning and the side-effect hook stay in
 * ONE place — and the app subclasses to choose the mount path, the store, and the access decision
 * per verb. Nothing in the plugin is edited to vary any of those.
 *
 * The base deliberately carries NO `@Controller` and NO access decoration. A path baked into the
 * plugin would decide the app's URL space, and an access decision baked in would be the plugin
 * deciding who may write to the app's storage. Both belong to whoever deploys it, and theokit#514
 * now refuses a subclass that forgets to say.
 */
class TestArtifactsController extends ArtifactsControllerBase {
  protected readonly handlers: ArtifactRouteHandlers = createArtifactRouteHandlers({
    store: createInMemoryArtifactStore(),
  })
}

const ARTIFACT = {
  id: 'note-1',
  kind: 'markdown' as const,
  title: 'A note',
  content: '# hello',
  version: 1,
}

function post(body: unknown): Request {
  return new Request('http://local/api/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('ArtifactsControllerBase — the plugin ships verbs, the app ships policy', () => {
  it('creates through the base, using the handlers the plugin already had', async () => {
    const controller = new TestArtifactsController()
    const response = await controller.create(post(ARTIFACT), ARTIFACT)
    expect(response.status).toBe(201)
  })

  it('lists what it created, so the subclass store is the one being used', async () => {
    const controller = new TestArtifactsController()
    await controller.create(post(ARTIFACT), ARTIFACT)

    const listed = await controller.list(new Request('http://local/api/artifacts'))
    const payload = (await listed.json()) as { artifacts: { id: string }[] }
    expect(payload.artifacts.map((a) => a.id)).toEqual(['note-1'])
  })

  it('keeps the security gate — a script-bearing artifact is still refused', async () => {
    // The reason `create` delegates instead of reimplementing. This artifact is rejected by
    // `enforceArtifactSecurity` inside the existing handler; a base that rebuilt the logic would
    // have to remember to call it, and the first version that forgot would ship stored XSS.
    const controller = new TestArtifactsController()
    const hostile = { ...ARTIFACT, kind: 'html' as const, content: '<script>alert(1)</script>' }
    const response = await controller.create(post(hostile), hostile)
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('carries no @Controller and no access decision — both belong to the app', () => {
    // Asserted, not assumed: a base that decorated itself would decide the consumer's URL space and
    // its auth posture, which is the coupling this shape exists to remove.
    // `CONTROLLER_PREFIX` imported rather than retyped: it is a SYMBOL, and a string literal of the
    // same text reads a different key entirely — an assertion written that way passes whatever the
    // class carries.
    expect(getMeta(CONTROLLER_PREFIX, ArtifactsControllerBase)).toBeUndefined()
    expect(Reflect.getMetadata('theokit:public', ArtifactsControllerBase)).toBeUndefined()
  })

  it('a subclass may decorate itself without the base interfering', () => {
    @Controller('api/artifacts')
    @SetMetadata('theokit:public', true)
    class Decorated extends ArtifactsControllerBase {
      protected readonly handlers = createArtifactRouteHandlers({
        store: createInMemoryArtifactStore(),
      })
    }
    expect(getMeta(CONTROLLER_PREFIX, Decorated)).toBeDefined()
  })
})
