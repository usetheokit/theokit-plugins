/**
 * The README describes the package that ships, not an earlier design of it.
 *
 * It told readers that `@theokit/orm` was a required peer the plugin wraps, that the plugin
 * re-exports orm's Repository surface, and that the package is MIT. None of it was true of the
 * published 0.6.0: the peers were `drizzle-orm`, `reflect-metadata` and `theokit`, `dist/index.js`
 * imports nothing from orm, and `package.json` says Apache-2.0. A reader who followed the install
 * line pulled in two packages this one never loads.
 *
 * `pnpm quality:doc-api` already compiles every documented import. What it cannot see is prose and
 * shell: an install line, a "re-exports" sentence, a license footer. Those are asserted here
 * against `package.json` and the module's real export list.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import * as entry from '../src/index.js'

const PACKAGE_DIR = join(import.meta.dirname, '..')
const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8')
const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
  name: string
  license: string
  peerDependencies: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/** Package names on every `pnpm add` / `npm i` line of the README, versions and tags stripped. */
function installedByReadme(): string[] {
  const names: string[] = []
  for (const line of readme.split('\n')) {
    const match = /^\s*(?:pnpm add|npm i(?:nstall)?|yarn add)\s+(.+)$/.exec(line)
    const args = match?.[1]?.split('#')[0]
    if (args === undefined) continue
    for (const token of args.trim().split(/\s+/)) {
      if (token.startsWith('-')) continue
      names.push(token.replace(/^(@?[^@]+)@.*$/, '$1'))
    }
  }
  return names
}

describe('plugin-db-drizzle README against the shipped package', () => {
  it('installs only this package and the peers it declares', () => {
    const allowed = new Set([
      manifest.name,
      ...Object.keys(manifest.peerDependencies),
      ...Object.keys(manifest.peerDependenciesMeta ?? {}),
    ])
    const installed = installedByReadme()
    expect(installed.length).toBeGreaterThan(0)
    expect(installed.filter((name) => !allowed.has(name))).toEqual([])
  })

  it('does not claim to re-export or wrap @theokit/orm', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'buildDbCommands',
      'buildDevtoolsTab',
      'drizzleDb',
      'renderDrizzleConfig',
    ])
    expect(readme).not.toMatch(/re-exports? orm/i)
    expect(readme).not.toMatch(/required peer/i)
    expect(readme).not.toMatch(/OrmModule\.forRoot/)
  })

  it('states the license package.json declares', () => {
    const section = /## License\s+([^\n]+)/.exec(readme)
    expect(section?.[1]?.trim()).toBe(manifest.license)
  })

  it('does not declare reflect-metadata, which nothing in this package loads', () => {
    // `reflect-metadata` was declared for `@theokit/orm` entities this package never touches.
    expect(Object.keys(manifest.peerDependencies)).not.toContain('reflect-metadata')
  })
})
