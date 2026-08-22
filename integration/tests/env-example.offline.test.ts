/**
 * Drift gate for the generated `.env.example`.
 *
 * The file is generated so it cannot disagree with the registry the suites actually read — a
 * hand-kept example drifts, and the failure is silent: a variable the code reads but the example
 * never mentioned looks like a credential nobody documented.
 *
 * Nothing checked that the committed file was what the generator produces, so it drifted anyway.
 * The versioned copy kept its pre-rename header for months, telling a contributor to copy it to
 * `e2e/.env` and to regenerate with `pnpm --filter @theokit/plugins-e2e env:example` — a filter
 * matching no project in this workspace. Someone following it concludes the generator is broken
 * and hand-edits the file, which is the drift generation was chosen to prevent (#90).
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { renderEnvExample } from '../scripts/env-example.js'
import { SERVICES } from '../src/services.js'

describe('.env.example', () => {
  it('is exactly what the generator produces from the registry', () => {
    const committed = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    expect(
      committed,
      'run `pnpm --filter @theokit/plugins-integration env:example` and commit the result',
    ).toBe(renderEnvExample(SERVICES))
  })

  it('names a variable for every registry entry', () => {
    // The property the generator exists to guarantee, asserted independently of how it renders:
    // a variable in the registry and absent from the example is a credential nobody can supply.
    const committed = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    const declared = SERVICES.flatMap((spec) => [
      ...spec.credentials,
      ...spec.target,
      ...(spec.optionalCredentials ?? []),
    ]).map((cred) => cred.name)

    const absent = declared.filter(
      (name) => !new RegExp(`^${name}=`, 'm').test(committed),
    )
    expect(absent, 'registry variables with no line in .env.example').toEqual([])
  })
})
