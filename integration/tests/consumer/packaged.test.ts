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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { moduleSpecifiers } from '../../src/module-specifiers.js'

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

/**
 * Node builtins whose BARE specifier collides with the builtin name. A built
 * file importing one of these without `node:` fails to resolve on runtimes that
 * only expose the prefixed form. Not exhaustive on purpose — it covers the ones
 * a plugin in this repo could plausibly reach for.
 */
const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'dns',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'process',
  'querystring',
  'readline',
  'stream',
  'stream/promises',
  'string_decoder',
  'timers',
  'tls',
  'url',
  'util',
  'worker_threads',
  'zlib',
])

const DIRS = packageDirs()

/**
 * Packages deliberately outside the packaging contract.
 *
 * Empty, and that is the point: marking a manifest `private: true` used to drop it from all
 * four assertions with a bare `continue`, leaving no trace in the output. A package can leave
 * this file's scope — but as a decision recorded here, not as a side effect of a manifest edit
 * nobody reads (#93).
 */
const PRIVATE_BY_DESIGN: readonly string[] = []

/** How many publishable packages this contract is expected to cover. */
const EXPECTED_PUBLISHABLE = 11

const PRIVATE = DIRS.filter((dir) => manifestOf(dir).private === true)
const PUBLISHABLE = DIRS.filter((dir) => manifestOf(dir).private !== true)

describe('consumer smoke — the packaging contract', () => {
  it('covers every publishable package under packages/, with no silent exclusions', () => {
    // `toBeGreaterThanOrEqual(11)` was the inverse of what the comment beside it promised:
    // it passed when a package was ADDED — 12 >= 11 — and failed only when one was removed.
    // The count is exact, so a new package fails this until the number is raised deliberately.
    expect(
      PUBLISHABLE.length,
      `packages/ holds ${PUBLISHABLE.length} publishable manifests: ${PUBLISHABLE.join(', ')}`,
    ).toBe(EXPECTED_PUBLISHABLE)

    expect(
      PRIVATE,
      'packages dropped from the packaging contract by `private: true` and not declared above',
    ).toEqual(PRIVATE_BY_DESIGN)
  })

  for (const dir of PUBLISHABLE) {
    const pkg = manifestOf(dir)

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

      it('imports Node builtins with the `node:` prefix the source wrote', () => {
        // #38: tsup 8 strips `node:` by default, so `node:crypto` in the source
        // shipped as bare `crypto` — which Deno, Bun and Workers-style runtimes
        // do not resolve. Nothing caught it, because the SOURCE was correct and
        // no unit test reads the built artifact. This does.
        //
        // Bare specifiers are checked against the builtin list rather than a
        // `node:` regex: a bare `crypto` could in principle be a real npm
        // package, and it is the collision with a builtin name that breaks
        // resolution, not the absence of a prefix in general.
        const offenders: string[] = []
        for (const file of files.filter((f) => f.endsWith('.js'))) {
          const text = readFileSync(join(REPO_ROOT, 'packages', dir, file), 'utf8')
          // Specifiers come from the AST, not a regex. The regex this replaced matched
          // `Buffer.from('crypto')` — `from` matched, `\(?` ate the paren, and the argument
          // was read as a module specifier — so ordinary code reported a packaging BLOCKER
          // that was not there, on every PR (#84).
          for (const spec of moduleSpecifiers(text, file)) {
            if (NODE_BUILTINS.has(spec)) offenders.push(`${file}: ${spec}`)
          }
        }
        expect(
          offenders,
          `${pkg.name} imports a Node builtin without the node: prefix (#38)`,
        ).toEqual([])
      })

      // Every subpath, not just the barrel. Presence in the tarball and a shipped .d.ts are
      // both static facts: they hold while `dist/stripe.js` imports a shared chunk that
      // stopped being packed, or pulls a peer nobody declared. Only resolving the subpath
      // answers the question this file exists to ask — if somebody installs this, does it
      // load — and it was asked of one subpath out of four (#83).
      const loadable = entries.filter(([subpath]) => subpath !== './package.json')

      for (const [subpath, target] of loadable) {
        const runtime = typeof target === 'string' ? target : target.import
        if (runtime === undefined) continue

        it(`resolves and loads ${subpath}`, async () => {
          // Imports dist/, not src/, so it exercises the bundled output and its externals.
          //
          // It does NOT exercise peers, and used to claim it did. The import is by absolute path
          // into `packages/<name>/`, so every peer resolves from this monorepo's own
          // `node_modules` and none is ever missing — a missing-peer defect survived in a PUBLISHED
          // package while this gate reported it green (B-016, B-032). `isolated-entries.offline.test.ts`
          // is the one that can see it: it copies `dist` into a fixture holding exactly the
          // declared dependencies.
          const mod = (await import(
            join(REPO_ROOT, 'packages', dir, normalize(runtime))
          )) as Record<string, unknown>
          expect(
            Object.keys(mod).length,
            `${pkg.name}${subpath === '.' ? '' : subpath.slice(1)} exports nothing at runtime`,
          ).toBeGreaterThan(0)
        }, 30_000)
      }
    })
  }
})
