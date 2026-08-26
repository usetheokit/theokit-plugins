import { Body, Get, Post, Req } from '@theokit/http'

import { artifactSchema } from '../schema.js'

import type { ArtifactRouteHandlers } from '../route-handlers.js'
import type { Artifact } from '../schema.js'

/**
 * The artifact endpoints as a controller a consuming app extends.
 *
 * ## Why this exists beside `createArtifactRouteHandlers`
 *
 * That function hands back functions for the app to mount, so every consumer rewrites the same
 * wiring and each decides afresh what the URL is, whether a session is required, and how the body
 * reaches the handler. Adding a verb then means editing every app that mounts one — a plugin open
 * for modification (SOLID, open/closed).
 *
 * Here the plugin declares the verbs once and the app supplies what is genuinely its own:
 *
 * ```ts
 * @Controller('api/artifacts')
 * export class ArtifactsController extends ArtifactsControllerBase {
 *   protected readonly handlers = createArtifactRouteHandlers({ store: myStore })
 *
 *   @Get()   @SetMetadata('theokit:public', true) override list(...)   { return super.list(...) }
 *   @Post()  @UseGuards(AuthGuard)                override create(...) { return super.create(...) }
 * }
 * ```
 *
 * ## What this class deliberately does NOT carry
 *
 * No `@Controller`, so the plugin never decides the app's URL space. No access decoration, so it
 * never decides who may write to the app's storage — theokit#514 makes a subclass that forgets to
 * say fail the build, which is a better guarantee than any default this could pick.
 *
 * ## Why it delegates rather than reimplements
 *
 * `handlers.create` carries the XSS gate (`enforceArtifactSecurity`), the auto-versioning, and the
 * `onAfterInsert` hook. A base that rebuilt that logic would own a second copy of a SECURITY
 * decision, and the first version that forgot the gate would ship stored XSS. One definition stays.
 *
 * ## Why `create` takes both `@Req()` and `@Body()`
 *
 * `handlers.create` takes a `Request` and reads its body. The `Request` that reaches a controller
 * has already been drained — `node-request.ts` says why: "a stream drains once" (theokit#400) — so
 * forwarding it returns `400 INVALID_BODY` on a payload that is valid JSON (theokit#517). Taking
 * the body through `@Body()`, which is what reads it, and handing the handler a `Request` carrying
 * the same bytes is the plugin absorbing that trap ONCE, rather than every consumer meeting it.
 */
export abstract class ArtifactsControllerBase {
  /** Supplied by the subclass — the app owns the store, and with it the persistence decision. */
  protected abstract readonly handlers: ArtifactRouteHandlers

  @Get()
  list(@Req() request: Request): Promise<Response> {
    return this.handlers.list(request)
  }

  @Post()
  create(@Req() request: Request, @Body(artifactSchema) body: Artifact): Promise<Response> {
    return this.handlers.create(
      new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(body),
      }),
    )
  }
}
