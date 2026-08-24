/**
 * A manifest edited without its lockfile must fail locally, not two minutes into CI.
 *
 * Measured 2026-08-23, twice in one day: a devDependency was added to `integration/package.json`,
 * `pnpm-lock.yaml` was left behind, all ten local gates passed, and CI failed at
 * `pnpm install --frozen-lockfile` with `ERR_PNPM_OUTDATED_LOCKFILE`. `--frozen-lockfile` appeared
 * in six workflow steps and zero `package.json` scripts, so the condition was undetectable by
 * anyone who had not pushed yet.
 *
 * This drives the REAL command against a REAL drift. Asserting that `--frozen-lockfile` appears in
 * `package.json` would pass against a script that never runs — the defect B-026 closed one item
 * ago, reproduced in the test meant to prevent it.
 *
 * The drift happens in a temporary copy, never in this repository: a crashed run would otherwise
 * leave a drifted lockfile behind, which is the exact condition under test, so the failure would
 * perpetuate itself.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const created: string[] = []
afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true })
})

/**
 * A copy of the workspace's manifests and lockfile — no sources, no `node_modules`.
 *
 * `--lockfile-only` resolves against the manifests and the lockfile alone, so that is all the copy
 * needs. Copying the whole tree would make each case take minutes for no added signal.
 */
function workspaceCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'lockfile-drift-'))
  created.push(root)
  // `.npmrc` is not optional here, and its absence fails in a way that looks unrelated: without
  // it pnpm reports `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` on `settings.autoInstallPeers`, which reads
  // as a lockfile problem rather than a missing config file. Measured while writing this test.
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc']) {
    cpSync(join(REPO_ROOT, file), join(root, file))
  }
  for (const dir of ['packages', 'integration']) {
    cpSync(join(REPO_ROOT, dir), join(root, dir), {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(REPO_ROOT.length)
        return !/(^|[/\\])(node_modules|dist|tests|src|coverage)([/\\]|$)/.test(rel)
      },
    })
  }
  return root
}

function checkLockfile(cwd: string): { code: number; output: string } {
  const result = spawnSync('pnpm', ['install', '--frozen-lockfile', '--lockfile-only'], {
    cwd,
    encoding: 'utf8',
  })
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('lockfile drift is caught before a push', () => {
  it('passes on an untouched workspace — the common case must stay green', () => {
    expect(checkLockfile(workspaceCopy()).code).toBe(0)
  })

  it('fails when a manifest gains a dependency the lockfile does not carry', () => {
    const root = workspaceCopy()
    const manifest = join(root, 'integration', 'package.json')
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      devDependencies?: Record<string, string>
    }
    // The same shape as both real incidents: a devDependency added to `integration/`.
    pkg.devDependencies = { ...pkg.devDependencies, 'left-pad': '^1.3.0' }
    writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`)

    const { code, output } = checkLockfile(root)

    expect(code).not.toBe(0)
    // The same error CI prints, deliberately: a developer who has seen it in a red PR recognises it
    // locally without learning a second vocabulary for one condition.
    expect(output).toMatch(/ERR_PNPM_OUTDATED_LOCKFILE/)
  })

  it('is the command `check:lockfile` actually runs', () => {
    // Without this the cases above could pass forever against a script the repository stopped
    // using — the self-report gap the seam suite exists to close.
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(scripts.scripts['check:lockfile']).toBe('pnpm install --frozen-lockfile --lockfile-only')
  })
})
