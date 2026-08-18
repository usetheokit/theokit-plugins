/**
 * What `register()` does against the contract the framework actually passes.
 *
 * The previous `register()` called `app.registerCliCommand()` and
 * `app.registerDevtoolsTab()`, guarded by `if (app.registerCliCommand)`. Neither
 * method exists on `TheoApp`, so the guards were always false and the body was a
 * silent no-op — seven documented CLI verbs and a devtools tab that could not
 * run (#43), typed against a locally invented interface (#42).
 *
 * These tests are typed against the REAL `TheoApp`, so the compiler is what
 * proves the shape, and they assert the honest contract: this plugin has no
 * runtime surface to publish, so `register()` touches nothing — deliberately,
 * not by omission.
 */
import type { TheoApp } from 'theokit/server'
import { describe, expect, it, vi } from 'vitest'

import { drizzleDb } from '../src/index.js'

function recordingApp(): { app: TheoApp; calls: string[] } {
  const calls: string[] = []
  return {
    app: {
      addHook: (name) => calls.push(`addHook:${name}`),
      decorateRequest: (key) => calls.push(`decorateRequest:${key}`),
    },
    calls,
  }
}

const OPTIONS = { driver: 'sqlite' as const, url: ':memory:' }

describe('drizzleDb() against the real TheoApp', () => {
  it('touches nothing, because it has no runtime surface to publish', () => {
    // Honest emptiness. `DrizzleDbPlugin` carries name/kind/options and no
    // client — the package hands DATABASE_URL to the consumer's drizzle-kit and
    // never connects, which is also why e2e/src/services.ts excludes it from the
    // live suites. There is nothing to put on `ctx`.
    const { app, calls } = recordingApp()
    drizzleDb(OPTIONS).register(app)
    expect(calls).toEqual([])
  })

  it('does not warn about a CLI namespace it cannot register', () => {
    // The old body logged "CLI namespace 'db' is already registered — extending
    // it" on a collision path that could never be reached. A warning that cannot
    // fire is worse than none: it reads, in review, like the case is handled.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { app } = recordingApp()
    drizzleDb(OPTIONS).register(app)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('accepts an unknown driver without complaint — recorded, not endorsed', () => {
    // Measured, not assumed: `resolveOptions` documents that "driver and url are
    // passed through unchanged (caller is responsible)". So there is no
    // boot-time validation, and a bogus driver surfaces later, inside
    // drizzle-kit, with drizzle-kit's own message.
    //
    // This assertion exists to pin the actual behaviour rather than to bless it.
    // Adding validation would be a real improvement and is out of scope for #42
    // / #43 — it would be a behaviour change, not a fabrication removal.
    expect(() => drizzleDb({ driver: 'nope' as never, url: 'x' })).not.toThrow()
  })
})
