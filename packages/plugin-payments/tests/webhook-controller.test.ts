import { CONTROLLER_PREFIX, getMeta, ROUTE_METHODS, USE_GUARDS } from '@theokit/http'
import type { RouteMethodEntry } from '@theokit/http'
import { describe, expect, it } from 'vitest'

import { StripeWebhookControllerBase } from '../src/server/webhook-controller.js'
import type { WebhookResult } from '../src/webhook.js'

/**
 * The base exists so an app varies the URL and the four collaborators without editing this package,
 * and stops re-deriving the result → status mapping the plugin already decided. Each test exercises
 * one of those, rather than asserting a decorator is present — a class that routes nowhere would
 * pass that.
 */

/** Drives the base without reaching Stripe: the seam under test is everything around the call. */
class TestWebhookController extends StripeWebhookControllerBase {
  // Never reached — `process` is overridden below. They are declared because the base demands
  // them, and that demand IS part of the contract under test: a subclass that forgot one must not
  // compile.
  protected readonly stripe = undefined as never
  protected readonly webhookSecret = 'whsec_test'
  protected readonly registry = undefined as never
  protected readonly store = undefined as never

  public seen: { rawBody: string; signature: string | undefined } | undefined
  public result: WebhookResult = { status: 'ok', eventId: 'evt_1', duplicate: false }

  protected override process(rawBody: string, signature: string | undefined): Promise<WebhookResult> {
    this.seen = { rawBody, signature }
    return Promise.resolve(this.result)
  }
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://x/api/stripe/webhook', { method: 'POST', body, headers })
}

describe('StripeWebhookControllerBase', () => {
  it('declares the verb so a subclass inherits a route it never wrote', () => {
    const routes = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, TestWebhookController)
    expect(routes?.map((r) => `${r.verb} ${r.path}`)).toEqual(['POST '])
  })

  it('binds no prefix and no guard, so the app owns the URL and the access decision', () => {
    expect(getMeta(CONTROLLER_PREFIX, TestWebhookController)).toBeUndefined()
    expect(getMeta(USE_GUARDS, TestWebhookController, 'handle')).toBeUndefined()
  })

  it('passes the body through UNPARSED, because the signature covers the exact bytes', async () => {
    const controller = new TestWebhookController()
    // Deliberately not canonical JSON: re-serialising would change these bytes and break the HMAC.
    const raw = '{"id":"evt_1",  "type":"payment_intent.succeeded"}'

    await controller.handle(post(raw, { 'stripe-signature': 't=1,v1=abc' }))

    expect(controller.seen?.rawBody).toBe(raw)
    expect(controller.seen?.signature).toBe('t=1,v1=abc')
  })

  it('reports a missing signature header as absent rather than as an empty string', async () => {
    const controller = new TestWebhookController()

    await controller.handle(post('{}'))

    expect(controller.seen?.signature).toBeUndefined()
  })

  it('maps a processed event to 200', async () => {
    const controller = new TestWebhookController()
    controller.result = { status: 'ok', eventId: 'evt_1', duplicate: false }

    const response = await controller.handle(post('{}'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ received: true, duplicate: false })
  })

  it('maps a replayed event to 200 too, so Stripe stops retrying it', async () => {
    const controller = new TestWebhookController()
    controller.result = { status: 'ok', eventId: 'evt_1', duplicate: true }

    const response = await controller.handle(post('{}'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ duplicate: true })
  })

  it('maps an invalid signature to 400', async () => {
    const controller = new TestWebhookController()
    controller.result = { status: 'signature_invalid', message: 'no signatures found' }

    const response = await controller.handle(post('{}'))

    expect(response.status).toBe(400)
  })

  it('maps a handler error to 500 so Stripe retries the delivery', async () => {
    const controller = new TestWebhookController()
    controller.result = {
      status: 'handler_error',
      eventId: 'evt_1',
      error: { message: 'boom', name: 'Error' } as never,
    }

    const response = await controller.handle(post('{}'))

    expect(response.status).toBe(500)
  })

  it('never puts the handler error text in the response body', async () => {
    const controller = new TestWebhookController()
    controller.result = {
      status: 'handler_error',
      eventId: 'evt_1',
      error: { message: 'sk_live_51LEAKED', name: 'Error' } as never,
    }

    const response = await controller.handle(post('{}'))

    expect(await response.text()).not.toContain('sk_live')
  })
})
