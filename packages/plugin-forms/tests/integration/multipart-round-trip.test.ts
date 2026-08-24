// @vitest-environment node
/**
 * The two sides have to agree, so this runs the OTHER side rather than describing it.
 *
 * `valuesToFormData` mirrors a convention that lives in `theokit`, not here: dot notation for
 * nesting, repeated keys for arrays. A unit test can only assert the keys this package emits — it
 * cannot notice the day the framework starts reading them differently. Re-implementing the
 * reconstruction inside the test would prove only that we are self-consistent, which was never in
 * doubt.
 *
 * So this drives a REAL action through the framework's own `executeAction`, over a real HTTP
 * request carrying a real multipart body:
 *
 *   valuesToFormData → fetch (browser-set boundary) → node:http → executeAction
 *     → theokit's body parser → its reconstruction → the action's handler
 *
 * Everything between the first arrow and the last is the framework's. What the handler receives is
 * what a consumer's action would receive.
 *
 * An earlier version imported the reconstruction out of a build chunk. It could not: the function
 * is internal and not exported. Reaching for `executeAction` — which IS exported — is what turned
 * this from a unit test wearing an integration name into the round trip it claims to be.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { valuesToFormData } from '../../src/adapter/valuesToFormData.js'

type ExecuteAction = (
  filePath: string,
  exportName: string,
  req: IncomingMessage,
  res: ServerResponse,
  loadModule: (path: string) => Promise<Record<string, unknown>>,
  serverDir: string,
  requestId: string,
  pluginRunner: unknown,
  csrfMode?: string,
) => Promise<void>

let executeAction: ExecuteAction
let server: Server
let baseUrl: string

/** What the action's handler saw, per request. */
let received: unknown
let currentAction: Record<string, unknown>

beforeAll(async () => {
  const { existsSync, readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')

  // Resolved through THIS package's own `node_modules/theokit`, which pnpm points at the version
  // plugin-forms declares. The previous version listed the workspace-root `.pnpm` store and took
  // the first `theokit@*` entry it found — whichever the filesystem happened to return, belonging
  // to whichever package. With two versions installed that is 0.48.8 while this package depends on
  // 0.50.1, so the suite was measuring a framework it does not use, and the DIAGNOSIS test below
  // could never have fired on the fix it promises to detect. A gate that cannot fail is the defect
  // this repository keeps finding in its own gates, and this one had it in its instrument.
  const dist = join(process.cwd(), 'node_modules', 'theokit', 'dist')
  if (!existsSync(dist)) {
    throw new Error(
      'theokit is not resolvable from packages/plugin-forms; agreement cannot be verified.',
    )
  }
  const holder = readdirSync(dist).find(
    (f) =>
      f.endsWith('.js') &&
      readFileSync(join(dist, f), 'utf8').includes('function formDataToObject') &&
      readFileSync(join(dist, f), 'utf8').includes('executeAction'),
  )
  if (holder === undefined) {
    // Fails loudly rather than skipping. A gate that goes quiet when its subject moves is the
    // failure this repository keeps finding in its own gates: it would report agreement it never
    // checked.
    throw new Error(
      'theokit no longer ships `executeAction` alongside its multipart reconstruction where this ' +
        'test can reach it. Check whether the convention itself changed before relaxing this.',
    )
  }
  const mod = (await import(pathToFileURL(join(dist, holder)).href)) as {
    executeAction?: ExecuteAction
  }
  if (typeof mod.executeAction !== 'function') {
    throw new Error('`executeAction` is no longer exported; agreement cannot be verified this way.')
  }
  executeAction = mod.executeAction

  server = createServer((req, res) => {
    void executeAction(
      'actions.ts',
      'upload',
      req,
      res,
      () => Promise.resolve({ upload: currentAction }),
      process.cwd(),
      'test-request',
      undefined,
      'off',
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** Define the action for this request, POST the converted values, return what the handler saw. */
async function roundTrip(
  values: Record<string, unknown>,
  schema: z.ZodTypeAny,
): Promise<{ status: number; seen: unknown }> {
  received = undefined
  currentAction = {
    input: schema,
    accept: 'form',
    csrf: false,
    handler: ({ input }: { input: unknown }) => {
      received = input
      return { ok: true }
    },
  }

  const response = await fetch(`${baseUrl}/api/__actions/actions/upload`, {
    method: 'POST',
    // No content-type header: `fetch` sets multipart/form-data with the boundary itself, which is
    // exactly what the browser does when `callAction` hands it a FormData.
    body: valuesToFormData(values, schema),
  })
  await response.text()
  return { status: response.status, seen: received }
}

describe('a real action, over a real multipart request', () => {
  it('receives every shape unchanged', async () => {
    const schema = z.object({
      title: z.string(),
      qty: z.number(),
      agreed: z.boolean(),
      user: z.object({ name: z.string(), age: z.number() }),
    })
    // No scalar array here: the framework's parser collapses repeated text parts, pinned in its
    // own test below rather than hidden inside this one.
    const values = {
      title: 'a title',
      qty: 7,
      agreed: false,
      user: { name: 'ana', age: 30 },
    }

    const { status, seen } = await roundTrip(values, schema)

    expect(status, 'the request never reached the handler').toBe(200)
    expect(seen).toEqual(values)
  })

  it('receives the file BYTES, not just its name', async () => {
    // The assertion the whole slice rests on. `JSON.stringify` on a File yields
    // `{"name":"a.txt","type":"text/plain",…}` — measured — so a test comparing names passes
    // against the very path that drops the content.
    const schema = z.object({ docs: z.array(z.instanceof(File)) })
    const file = new File(['the actual bytes'], 'a.txt', { type: 'text/plain' })

    const { seen } = await roundTrip({ docs: [file] }, schema)
    const docs = (seen as { docs: Blob[] }).docs

    expect(docs).toHaveLength(1)
    expect(await docs[0]!.text()).toBe('the actual bytes')
  })

  it('rejects a body the schema refuses, so the failure path still reaches the field', async () => {
    // B-012's second DoD bullet: a server rejection must arrive as a field error, exactly as a
    // non-file rejection does. The transport changed; the error path must not have.
    const schema = z.object({ title: z.string().min(20) })

    const { status, seen } = await roundTrip({ title: 'too short' }, schema)

    expect(status).not.toBe(200)
    expect(seen, 'an invalid body reached the handler').toBeUndefined()
  })

  it('carries an empty array as an empty array, not as one empty string', async () => {
    const schema = z.object({ tags: z.array(z.string()) })

    const { seen } = await roundTrip({ tags: [] }, schema)

    expect((seen as { tags: unknown }).tags).toEqual([])
  })
})

describe('what the framework can and cannot carry', () => {
  it('a scalar array survives the round trip', async () => {
    // This was the DIAGNOSIS test, and it asserted the opposite: `toEqual(['third'])`. The
    // framework collected text parts into a plain object (`fields[key] = value`), so two parts
    // named `tags` overwrote each other before the FormData was rebuilt, and by the time
    // `formDataToObject` called `getAll('tags')` there was only ever one value to get.
    //
    // Fixed upstream in usetheokit/theokit#430, shipped in `theokit@0.50.1`, and verified against
    // the published package rather than a local build. The three producer sites now accumulate;
    // the consumer end was always correct.
    //
    // What is asserted here is the CONVENTION holding end to end — `valuesToFormData` writes the
    // parts, the framework reads them back, the handler sees what the caller passed. That is the
    // same thing the test always measured; only the answer changed.
    //
    // Version boundary, stated because it is load-bearing: this passes against >= 0.50.1 and fails
    // against everything before it. `packages/plugin-forms/package.json` pins the devDependency at
    // `>=0.50.1` for exactly that reason. Widening it back below that version turns this red, which
    // is the correct outcome and not a regression in this package.
    const schema = z.object({ tags: z.array(z.string()) })

    const { seen } = await roundTrip({ tags: ['first', 'second', 'third'] }, schema)

    expect((seen as { tags: string[] }).tags).toEqual(['first', 'second', 'third'])
  })

  it('but a FILE array survives, because files are not collected into an object', async () => {
    // The same parser keeps files in an ARRAY (`files.push({fieldName, …})`), so repeated file
    // parts are all preserved. This is why the limitation above does not reach the feature B-012
    // asked for.
    const schema = z.object({ docs: z.array(z.instanceof(File)) })
    const a = new File(['first bytes'], 'a.txt', { type: 'text/plain' })
    const b = new File(['second bytes'], 'b.txt', { type: 'text/plain' })

    const { seen } = await roundTrip({ docs: [a, b] }, schema)
    const docs = (seen as { docs: Blob[] }).docs

    expect(docs, 'multiple files collapsed the way scalars do').toHaveLength(2)
    expect(await docs[0]!.text()).toBe('first bytes')
    expect(await docs[1]!.text()).toBe('second bytes')
  })
})
