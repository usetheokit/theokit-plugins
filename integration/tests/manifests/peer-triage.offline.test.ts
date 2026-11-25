/**
 * Peer triage: `plugin-canvas` declares six Markdown peers that only `@theokit/ui` imports.
 * They are exempted one by one, so an unrelated unused peer must still fail and a direct
 * import must make the exemption stale.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../../../scripts/validate-manifests.mjs', import.meta.url))
const PEERS = [
  'hast-util-sanitize',
  'hast-util-to-jsx-runtime',
  'mdast-util-from-markdown',
  'mdast-util-gfm',
  'mdast-util-to-hast',
  'micromark-extension-gfm',
]

const created: string[] = []
afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true })
})

function fixture(extraPeers: string[], source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'peer-triage-'))
  created.push(root)
  const dir = join(root, 'packages', 'plugin-canvas')
  mkdirSync(join(dir, 'src'), { recursive: true })
  const peerDependencies = Object.fromEntries([...PEERS, ...extraPeers].map((p) => [p, '^1.0.0']))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: '@fixture/plugin-canvas',
      version: '0.0.0',
      private: true,
      peerDependencies,
    }),
  )
  writeFileSync(join(dir, 'src', 'index.ts'), source)
  mkdirSync(join(root, 'integration', 'src'), { recursive: true })
  writeFileSync(
    join(root, 'integration', 'src', 'integrating-packages.ts'),
    'export const INTEGRATING_PACKAGES = []\n',
  )
  return root
}

function validate(cwd: string): { code: number; output: string } {
  const r = spawnSync('node', [SCRIPT], { cwd, encoding: 'utf8' })
  return { code: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('plugin-canvas markdown peers', () => {
  it('accepts the six triaged peers', () => {
    const { output } = validate(fixture([], 'export const a = 1\n'))
    expect(output).not.toMatch(/declares a `(hast|mdast|micromark)[^`]*` peerDependency/)
  })

  it('still refuses an unrelated unused peer', () => {
    const { code, output } = validate(fixture(['left-pad'], 'export const a = 1\n'))
    expect(code).toBe(1)
    expect(output).toMatch(/declares a `left-pad` peerDependency/)
  })

  it('calls the exemption stale once the package imports the peer', () => {
    const { output } = validate(
      fixture([], "import { gfm } from 'mdast-util-gfm'\nexport const a = gfm\n"),
    )
    expect(output).toMatch(/exemption is stale, remove mdast-util-gfm/)
  })
})
