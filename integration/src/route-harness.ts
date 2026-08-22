/**
 * Serves a `RouteConfig` through TheoKit's own `executeRoute`, over a real HTTP server.
 *
 * The seam suite used to invoke `config.handler(ctx)` directly, building `ctx` by hand. That
 * skips every stage the framework runs before a handler — CSRF, body parsing, Zod validation,
 * plugin pre-handlers — and, worse, it builds a `ctx` the framework never builds: the shim put
 * the test's own body-carrying `Request` on `ctx.request`, while TheoKit puts a request with no
 * body there and delivers the parsed body separately as `ctx.body` (#76). A suite written to
 * prove that a provider composes with a route was therefore proving that it composes with the
 * shim.
 *
 * This runs the real thing. The route module is served from memory rather than from disk —
 * `LoadModule` is just `(path) => Promise<Record<string, unknown>>` — so no fixture files are
 * needed, and nothing about the request pipeline is stubbed.
 *
 * The client is `node:http` rather than `fetch` on purpose: the suites stub global `fetch` to
 * stand in for the identity provider's outbound HTTP, and an inbound call through the same stub
 * would never reach the server.
 */

import { createServer, request as nodeRequest } from 'node:http'
import type { AddressInfo } from 'node:net'

import { executeRoute } from 'theokit/server'

/** What a call to the served route returned, read off the wire. */
export interface RouteResponse {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

/** One HTTP call against the served route. */
export interface RouteCall {
  readonly method?: string
  /** Path and query, e.g. `/route?code=c`. */
  readonly path?: string
  readonly headers?: Record<string, string>
  readonly body?: string
}

/** Issues calls against the route under test. */
export type Caller = (call?: RouteCall) => Promise<RouteResponse>

/** The route node executeRoute matches against. Fixed path: this server serves one route. */
const ROUTE_NODE = {
  filePath: '/virtual/route.ts',
  routePath: '/route',
  paramNames: [] as string[],
  pattern: /^\/route$/,
}

/**
 * Run `body` with a live server executing `routes`, keyed by uppercase HTTP method.
 *
 * The server is closed even when `body` throws, so a failing assertion cannot leave a listener
 * behind and make the next test hang on a port that is still bound.
 */
export async function withRoute<T>(
  routes: Record<string, unknown>,
  body: (call: Caller) => Promise<T>,
): Promise<T> {
  const server = createServer((req, res) => {
    void executeRoute({
      route: { ...ROUTE_NODE, methods: Object.keys(routes) },
      method: (req.method ?? 'GET').toUpperCase(),
      params: {},
      req,
      res,
      loadModule: () => Promise.resolve(routes),
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  const call: Caller = (options = {}) =>
    new Promise<RouteResponse>((resolve, reject) => {
      const req = nodeRequest(
        {
          host: '127.0.0.1',
          port,
          method: options.method ?? 'GET',
          path: options.path ?? '/route',
          headers: options.headers ?? {},
        },
        (res) => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => (text += chunk))
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
          )
        },
      )
      req.on('error', reject)
      if (options.body !== undefined) req.write(options.body)
      req.end()
    })

  try {
    return await body(call)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
