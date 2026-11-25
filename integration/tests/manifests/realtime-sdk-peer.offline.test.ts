/** The realtime sdk peer floor must not sit below the sdk version the package builds against. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../packages/plugin-realtime/package.json', import.meta.url)),
    'utf8',
  ),
) as { devDependencies: Record<string, string>; peerDependencies: Record<string, string> }

describe('plugin-realtime sdk peer', () => {
  it('floors the peer at the version it builds against', () => {
    expect(pkg.devDependencies['@theokit/sdk']).toBe('5.12.1')
    expect(pkg.peerDependencies['@theokit/sdk']).toBe('>=5.12.1')
  })
})
