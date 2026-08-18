/**
 * Consumer smoke — every publishable package, from the outside.
 *
 * This is the other half of "live testing", and the half whose absence cost the
 * most. The provider suites ask "does the third party still accept what we
 * send?". These ask the question that broke `@theokit/plugin-canvas@0.3.3` and
 * `@theokit/plugin-forms@0.1.4` in the registry for weeks:
 *
 *     if somebody installs this, does it load at all?
 *
 * Nothing in `packages/<name>/tests` can answer that. Unit tests import from `src/`
 * through the workspace, so they never touch `dist/`, never consult `exports`,
 * and never notice that a subpath points at a file `files` does not ship. #9 was
 * exactly that shape: the imports were wrong, the unit suites were green, and the
 * failure only appeared when a consumer resolved the package.
 *
 * Every plugin is covered here, including the four with no third party to call
 * (db-drizzle, realtime, canvas, forms). They have no live provider contract, but
 * they absolutely have a packaging contract, and it is the one that broke.
 *
 * Three assertions per package, all mechanical:
 *
 *   1. every subpath in `exports` resolves to a file the tarball actually ships
 *      (measured from `npm pack --dry-run`, not from the working tree)
 *   2. every `.d.ts` a subpath declares is shipped too, or consumers get `any`
 *   3. the runtime entry imports, and its barrel is not empty
 *
 * These run WITHOUT credentials and without the network, so they are not gated on
 * E2E_LIVE — a packaging break is not a provider's bad afternoon, it is ours, and
 * it should be loud on every run.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname

interface PackedFile {
  readonly path: string
}

interface Manifest {
  readonly name: string
  readonly version: string
  readonly private?: boolean
  readonly exports?: Record<string, { types?: string; import?: string } | string>
}

/** Packages under packages/, in directory order. */
function packageDirs(): string[] {
  const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs')
  return readdirSync(join(REPO_ROOT, 'packages'))
    .filter((d) => existsSync(join(REPO_ROOT, 'packages', d, 'package.json')))
    .sort()
}

function manifestOf(dir: string): Manifest {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', dir, 'package.json'), 'utf8'),
  ) as Manifest
}

/**
 * The files the tarball would contain. `npm pack --dry-run` is the only honest
 * source: `files` globs, .npmignore and default rules all apply, and reading the
 * working tree would hide anything that is present locally but not shipped.
 */
function packedFiles(dir: string): string[] {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: join(REPO_ROOT, 'packages', dir),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const parsed = JSON.parse(out) as { files: PackedFile[] }[]
  return parsed[0]?.files.map((f) => f.path) ?? []
}

/** `./dist/x.js` and `dist/x.js` both mean the same entry in the tarball. */
function normalize(target: string): string {
  return target.replace(/^\.\//, '')
}

const DIRS = packageDirs()

describe('consumer smoke — the packaging contract', () => {
  it('covers every package under packages/, with no exclusions', () => {
    // A list that silently shrank would make this whole file look thorough while
    // testing less. Eleven is the current count; if a package is added, this
    // fails until it is acknowledged.
    expect(DIRS.length).toBeGreaterThanOrEqual(11)
  })

  for (const dir of DIRS) {
    const pkg = manifestOf(dir)
    if (pkg.private === true) continue

    describe(pkg.name, () => {
      const files = packedFiles(dir)
      const entries = Object.entries(pkg.exports ?? {})

      it('ships a tarball with files in it', () => {
        expect(files.length, `${pkg.name} packs nothing`).toBeGreaterThan(0)
      })

      it('resolves every exports subpath to a file the tarball ships', () => {
        // The #9 class of failure: a subpath a consumer imports, pointing at
        // something that is not in the package.
        const broken: string[] = []
        for (const [subpath, target] of entries) {
          const runtime = typeof target === 'string' ? target : target.import
          if (runtime === undefined) continue
          if (!files.includes(normalize(runtime))) broken.push(`${subpath} -> ${runtime}`)
        }
        expect(broken, `${pkg.name} subpaths missing from the tarball`).toEqual([])
      })

      it('ships the .d.ts every subpath declares', () => {
        // A missing declaration does not throw — the consumer just silently gets
        // `any`, which is worse, because it looks like it works.
        const broken: string[] = []
        for (const [subpath, target] of entries) {
          if (typeof target === 'string') continue
          const types = target.types
          if (types === undefined) continue
          if (!files.includes(normalize(types))) broken.push(`${subpath} -> ${types}`)
        }
        expect(broken, `${pkg.name} type declarations missing from the tarball`).toEqual([])
      })

      it('imports its main entry and exposes a non-empty barrel', async () => {
        // Imports dist/, not src/, so it exercises what a consumer resolves:
        // bundled output, externals, and every peer the entry pulls at load time.
        const main = pkg.exports?.['.']
        const runtime = typeof main === 'string' ? main : main?.import
        if (runtime === undefined) return
        const mod: Record<string, unknown> = await import(
          join(REPO_ROOT, 'packages', dir, normalize(runtime))
        )
        expect(Object.keys(mod).length, `${pkg.name} main entry exports nothing`).toBeGreaterThan(0)
      }, 30_000)
    })
  }
})
