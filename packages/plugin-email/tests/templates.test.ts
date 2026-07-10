/**
 * RED tests for P#7 T2.1 — defineEmailTemplate factory.
 */
import { describe, expect, it } from 'vitest'

import { defineEmailTemplate, type EmailTemplate } from '../src/templates.js'

describe('defineEmailTemplate (P#7 T2.1)', () => {
  it('returns descriptor with name + render function', () => {
    const tpl = defineEmailTemplate('welcome', () =>
      Promise.resolve({
        subject: 'Welcome',
        html: '<h1>Hi</h1>',
      }),
    )
    expect(tpl.name).toBe('welcome')
    expect(typeof tpl.render).toBe('function')
  })

  it('render() returns RenderedTemplate shape with optional text', async () => {
    const tpl = defineEmailTemplate<{ name: string }>('welcome', (props) =>
      Promise.resolve({
        subject: `Welcome ${props.name}`,
        html: `<h1>Hi ${props.name}</h1>`,
        text: `Hi ${props.name}`,
      }),
    )
    const out = await tpl.render({ name: 'Ana' })
    expect(out.subject).toBe('Welcome Ana')
    expect(out.html).toContain('Ana')
    expect(out.text).toBe('Hi Ana')
  })

  it('typed props prevent shape mismatch (compile-time enforcement)', async () => {
    // Given: a template typed on {orderId: string}
    const tpl: EmailTemplate<{ orderId: string }> = defineEmailTemplate('order-receipt', (props) =>
      Promise.resolve({
        subject: `Order ${props.orderId}`,
        html: `<p>Order ${props.orderId} confirmed</p>`,
      }),
    )

    // Then: passing the typed shape works
    const out = await tpl.render({ orderId: 'ord_xxx' })
    expect(out.subject).toBe('Order ord_xxx')
  })
})
