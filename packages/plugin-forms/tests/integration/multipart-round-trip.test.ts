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
  const { readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')

  const root = join(process.cwd(), '..', '..', 'node_modules', '.pnpm')
  const pkg = readdirSync(root).find((d) => d.startsWith('theokit@'))
  if (pkg === undefined) throw new Error('theokit is not installed; agreement cannot be verified.')
  const dist = join(root, pkg, 'node_modules', 'theokit', 'dist')
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
  it('DIAGNOSIS: a scalar array loses every element but the last', async () => {
    // Measured, and it is a framework defect rather than a converter one. `parseWebRequestBody`
    // collects text parts into a PLAIN OBJECT (`fields[key] = value`), so two parts named `tags`
    // overwrite each other before `synthesizeFormData` rebuilds the FormData. By the time
    // `formDataToObject` calls `getAll('tags')`, there is only ever one value to get.
    //
    // There is no client-side fix: the collapse happens upstream of the convention. Pinning it
    // here so the limitation is a checked fact rather than a footnote, and so the day it is fixed
    // this test fails and tells us.
    const schema = z.object({ tags: z.array(z.string()) })

    const { seen } = await roundTrip({ tags: ['first', 'second', 'third'] }, schema)

    expect((seen as { tags: string[] }).tags).toEqual(['third'])
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
