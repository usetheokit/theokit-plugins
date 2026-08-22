/**
 * Unit tests for the classifier that decides whether a suite needs a credential.
 *
 * The gate in `readiness.offline.test.ts` uses this to answer "may this suite run on a PR?".
 * It used to answer by regexing the raw source, so a file that merely DESCRIBED the convention
 * in a comment was classified as credential-bound and silently left the gate's scope (#99).
 *
 * The fixtures below are strings on purpose: they let the classifier be tested against shapes
 * that do not exist on disk, including the comment and string-literal cases that broke it.
 * Note the file you are reading would itself have been mis-classified by the old detector —
 * it mentions `required(` and `describeLive(` many times, in fixtures, and calls neither.
 */

import { describe, expect, it } from 'vitest'

import { callsCredentialBoundApi } from '../src/suite-classification.js'

describe('callsCredentialBoundApi', () => {
  it('detects a direct call to required()', () => {
    const source = `
      import { required } from '../../src/credentials.js'
      const key = required('RESEND_API_KEY')
    `
    expect(callsCredentialBoundApi(source)).toBe(true)
  })

  it('detects a suite declared through describeLive()', () => {
    const source = `
      import { describeLive } from '../../src/harness.js'
      describeLive(SPEC, 'sends mail', () => {})
    `
    expect(callsCredentialBoundApi(source)).toBe(true)
  })

  it('ignores a mention inside a line comment', () => {
    // The exact defect: this is how readiness.test.ts exempted itself for months.
    const source = `
      // a suite that calls no \`required(...)\` and no \`describeLive(...)\` needs no credential
      export const nothing = 1
    `
    expect(callsCredentialBoundApi(source)).toBe(false)
  })

  it('ignores a mention inside a block comment', () => {
    const source = `
      /**
       * Documented contract: call required('FOO') when the suite needs a credential.
       */
      export const nothing = 1
    `
    expect(callsCredentialBoundApi(source)).toBe(false)
  })

  it('ignores a mention inside a string literal', () => {
    const source = `
      const message = 'call describeLive(spec, name, body) to gate a live suite'
      export { message }
    `
    expect(callsCredentialBoundApi(source)).toBe(false)
  })

  it('returns false for a suite that calls neither', () => {
    const source = `
      import { expect, it } from 'vitest'
      it('packs a tarball', () => { expect(1).toBe(1) })
    `
    expect(callsCredentialBoundApi(source)).toBe(false)
  })

  it('follows a renamed named import', () => {
    // `import { required as need }` is still a credential-bound call; missing it would
    // put a paid suite on every PR without anyone seeing it.
    const source = `
      import { required as need } from '../../src/credentials.js'
      const key = need('OPENAI_API_KEY')
    `
    expect(callsCredentialBoundApi(source)).toBe(true)
  })

  it('follows a namespace import', () => {
    const source = `
      import * as creds from '../../src/credentials.js'
      const key = creds.required('GROQ_API_KEY')
    `
    expect(callsCredentialBoundApi(source)).toBe(true)
  })

  it('does not confuse an unrelated method of the same name', () => {
    // A schema builder with a `.required()` method must not be read as a credential call.
    const source = `
      import { z } from 'zod'
      const schema = z.string().required()
    `
    expect(callsCredentialBoundApi(source)).toBe(false)
  })

  it('does not treat an import without a call as a credential-bound suite', () => {
    // Importing the symbol and never calling it means the suite does not gate on it.
    const source = `
      import { required } from '../../src/credentials.js'
      export type Unused = typeof required
    `
    expect(callsCredentialBoundApi(source)).toBe(false)
  })
})
