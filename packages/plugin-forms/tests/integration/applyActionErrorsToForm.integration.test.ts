// @vitest-environment node
/**
 * Phase 6 / T6.1 — integration test per plan p4-plugin-forms v1.1 ADR D7.
 *
 * Strategy: spin up an in-process Node http.createServer that mimics the G3
 * server-side action endpoint. The test imports the plugin's adapter +
 * triggers a fetch round-trip against the live server; asserts that
 * ActionInputError-shaped responses map correctly via applyActionErrorsToForm.
 *
 * CKP-6 (EC-6 absorbed): server.listen(0) for OS-assigned port — never
 * hardcoded — to avoid conflicts under vitest parallel workers.
 *
 * No mocked dispatcher per ADR D7. Uses real Request/Response semantics.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { applyActionErrorsToForm } from '../../src/adapter/applyActionErrorsToForm.js'

let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url !== '/api/__actions/save-memory/saveMemory' || req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found' }))
      return
    }
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { content?: string }
        if (typeof parsed.content !== 'string' || parsed.content.length === 0) {
          // Mimic G3 ActionInputError shape per action-protocol.ts:149-175
          res.writeHead(422, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              type: 'TheoActionInputError',
              code: 'VALIDATION_ERROR',
              status: 422,
              issues: [{ path: ['content'], message: 'Required' }],
              fields: { content: ['Required'] },
            }),
          )
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'mem_test_001' }))
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code: 'BAD_REQUEST', message: 'Invalid JSON' }))
      }
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        throw new Error('server.address() returned non-object')
      }
      // CKP-6 — random port from OS, never hardcoded
      baseUrl = `http://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
})

describe('integration — real fetch round-trip → adapter (ADR D7)', () => {
  it('success response: 200 + JSON body, no errors fired', async () => {
    const setError = vi.fn()
    const response = await fetch(`${baseUrl}/api/__actions/save-memory/saveMemory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Real fetch proof' }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string }
    expect(body.id).toBe('mem_test_001')
    // No error → adapter not called (consumer's responsibility to only
    // invoke applyActionErrorsToForm when error.fields is present).
    expect(setError).not.toHaveBeenCalled()
  })

  it('ActionInputError response: 422 + fields map, adapter fires setError per field', async () => {
    const setError = vi.fn()
    const response = await fetch(`${baseUrl}/api/__actions/save-memory/saveMemory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(422)
    const body = (await response.json()) as { fields: Record<string, string[]>; type: string }
    expect(body.type).toBe('TheoActionInputError')
    expect(body.fields).toEqual({ content: ['Required'] })
    // Consumer wires the adapter (same path <TheoForm> uses internally)
    applyActionErrorsToForm(setError, body.fields)
    expect(setError).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith('content', { type: 'server', message: 'Required' })
  })

  it('404 path: response not consumed by adapter (no fields key)', async () => {
    const setError = vi.fn()
    const response = await fetch(`${baseUrl}/api/__actions/non-existent/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(404)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('NOT_FOUND')
    // No fields in response → adapter never invoked
    expect(setError).not.toHaveBeenCalled()
  })
})
