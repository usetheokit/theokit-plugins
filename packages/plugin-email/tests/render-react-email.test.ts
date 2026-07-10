/**
 * Tests for P#7 T2.2 — renderReactEmail dynamic-import bridge.
 *
 * #228: the happy path is now covered by mocking the optional
 * `@react-email/render` peer (rather than left untested), and the
 * missing-dependency case is decoupled from the test environment by mocking the
 * import to reject — so the assertion no longer depends on the peer happening to
 * be ABSENT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('renderReactEmail (P#7 T2.2 / #228)', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.doUnmock('@react-email/render')
    vi.resetModules()
  })

  it('function is exported and callable', async () => {
    const { renderReactEmail } = await import('../src/render-react-email.js')
    expect(typeof renderReactEmail).toBe('function')
  })

  it('test_render_react_email_happy_path', async () => {
    // Peer present (mocked): renders the component to HTML.
    vi.doMock('@react-email/render', () => ({
      render: (_el: unknown) => Promise.resolve('<html><h1>Hi</h1></html>'),
    }))
    const { renderReactEmail } = await import('../src/render-react-email.js')
    const html = await renderReactEmail({})
    expect(html).toBe('<html><h1>Hi</h1></html>')
  })

  it('test_render_react_email_missing_dep_mocked', async () => {
    // Peer missing (mocked import reject): actionable error — independent of
    // whether @react-email/render happens to be installed in this environment.
    vi.doMock('@react-email/render', () => {
      throw new Error("Cannot find module '@react-email/render'")
    })
    const { renderReactEmail } = await import('../src/render-react-email.js')
    await expect(renderReactEmail({})).rejects.toThrow(/react-email\/render not installed/)
  })
})
