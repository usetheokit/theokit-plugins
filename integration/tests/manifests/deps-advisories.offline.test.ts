/**
 * The gate must be red for the right reason and green for the right reason.
 *
 * All nineteen HIGH advisories in this workspace enter through a devDependency — measured, not
 * assumed — so the gate passes today. That is deliberate: a gate that went red on arrival over
 * findings nobody can act on gets allowlisted wholesale or deleted, and the repository ends up worse
 * than before it existed.
 *
 * Which leaves a problem this suite exists to solve. A gate that never fires is indistinguishable
 * from a gate that cannot fire, and the difference only shows up on the day it matters. So the
 * failing path is exercised here against fixtures, on every run, while production output stays
 * green.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const TOOL = join(REPO_ROOT, 'tools', 'check-deps-advisories.mjs')
const created: string[] = []

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true })
})

/**
 * A fixture root with one manifest and a stub `pnpm` on PATH returning `advisories`.
 *
 * The stub is what makes the failing path testable at all: adding a genuinely vulnerable runtime
 * dependency to this repository to watch a gate go red would be a strange way to test a gate.
 */
function fixture(manifest: Record<string, unknown>, auditJson: string): string {
  const root = mkdtempSync(join(tmpdir(), 'deps-adv-'))
  created.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))

  const bin = join(root, 'bin')
  mkdirSync(bin)
  const stub = join(bin, 'pnpm')
  // `pnpm audit` exits non-zero when it finds anything, so the stub does too — otherwise the test
  // would pass against a checker that only handles the zero-findings case.
  writeFileSync(stub, `#!/bin/sh\ncat <<'JSON'\n${auditJson}\nJSON\nexit 1\n`)
  chmodSync(stub, 0o755)
  return root
}

function run(root: string): { code: number; output: string } {
  const result = spawnSync('node', [TOOL], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPS_AUDIT_ROOT: root,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    },
  })
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** One HIGH advisory whose path enters `origin` through `firstEdge`. */
function advisory(origin: string, firstEdge: string, module = 'vulnerable-pkg'): string {
  return JSON.stringify({
    advisories: {
      '1': {
        severity: 'high',
        module_name: module,
        findings: [{ paths: [`${origin}>${firstEdge}>${module}`] }],
      },
    },
  })
}

describe('an advisory that reaches a runtime chain', () => {
  it('fails, naming the package and the chain', () => {
    const root = fixture(
      { name: 'fx', dependencies: { 'some-lib': '^1' } },
      advisory('.', 'some-lib'),
    )

    const { code, output } = run(root)

    expect(code, 'a shipping advisory was accepted').toBe(1)
    expect(output).toMatch(/RUNTIME chain/)
    expect(output).toMatch(/vulnerable-pkg/)
    expect(output).toMatch(/some-lib/)
  })

  it('treats an undeclared first edge as runtime, which is the conservative side', () => {
    // A chain nobody can classify might ship. A security gate should be loud about an unknown
    // rather than quiet, and quiet is what "assume dev" would be.
    const root = fixture({ name: 'fx' }, advisory('.', 'not-in-any-section'))

    const { code, output } = run(root)

    expect(code).toBe(1)
    expect(output).toMatch(/treated as runtime/)
  })
})

describe('an advisory contained in a dev chain', () => {
  it('passes, and says what it found', () => {
    // Passing SILENTLY would make this gate indistinguishable from an absent one — which is the
    // state the item that produced it describes.
    const root = fixture(
      { name: 'fx', devDependencies: { 'build-tool': '^1' } },
      advisory('.', 'build-tool'),
    )

    const { code, output } = run(root)

    expect(code, 'a dev-chain advisory failed the build').toBe(0)
    expect(output, 'passed without reporting what it found').toMatch(/dev-chain/)
    expect(output).toMatch(/vulnerable-pkg/)
  })

  it('reads the kind from the manifest, so moving the dependency flips the verdict', () => {
    // The distinction is measured, not asserted: the SAME advisory, classified by which section
    // declares it. A list of package names could never do this.
    const asDev = run(fixture({ name: 'fx', devDependencies: { lib: '^1' } }, advisory('.', 'lib')))
    const asRuntime = run(
      fixture({ name: 'fx', dependencies: { lib: '^1' } }, advisory('.', 'lib')),
    )

    expect(asDev.code).toBe(0)
    expect(asRuntime.code).toBe(1)
  })
})

describe('when the audit cannot run', () => {
  it('fails saying so, rather than passing silently', () => {
    // Three gates in this repository have printed a success line the run had not earned. A security
    // gate doing it would report absence as evidence.
    const root = fixture({ name: 'fx' }, 'this is not json at all')

    const { code, output } = run(root)

    expect(code, 'an unparseable audit was treated as clean').toBe(1)
    expect(output).toMatch(/did not run/)
    expect(output, 'claimed a check it did not make').not.toMatch(/PASS/)
  })
})

describe('this repository, today', () => {
  it('passes, with every HIGH advisory contained in a dev chain', () => {
    // The assertion that has to change on the day one ships — which is the point of having it.
    const result = spawnSync('node', [TOOL], { cwd: REPO_ROOT, encoding: 'utf8' })

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)
    expect(`${result.stdout}`).toMatch(/none reaching a runtime chain/)
  }, 120_000)
})
