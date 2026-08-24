/**
 * Every published entry loads from a layout that does NOT resolve peers from this monorepo.
 *
 * `packaged.test.ts` imports each entry by absolute path into `packages/<name>/`, so every peer
 * resolves from the monorepo's own `node_modules`. Its comment claimed the assertion exercises
 * "bundled output, externals, and every peer the entry pulls at load time" — it exercises the first
 * two and **cannot** exercise the third, because in that layout no peer is ever missing.
 *
 * That is not an abstract gap. B-016 was a missing-peer defect that survived in a PUBLISHED package
 * while a gate whose stated purpose is "if somebody installs this, does it load at all?" reported it
 * green.
 *
 * So this file stages the layout that can see it: the built `dist` COPIED into a fixture whose
 * `node_modules` holds exactly the package's DECLARED peers and dependencies, and nothing else. An
 * entry importing something it never declared cannot resolve it here, which is the whole point.
 *
 * The copy is load-bearing, and the trap it avoids was measured: a first probe SYMLINKED the package
 * and passed, because Node resolves a symlink to its real path and resolution then walked up into
 * the monorepo — measuring the monorepo while believing it measured a consumer. The peers are still
 * symlinked, which is safe for them: they are real installs whose own dependencies resolving from
 * the store is correct.
 *
 * Credential-free by construction — `*.offline.test.ts`, so it runs on every pull request.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const PACKAGES = join(REPO_ROOT, 'packages')

const created: string[] = []
afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true })
})

interface Manifest {
  name: string
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

function manifests(): { dir: string; pkg: Manifest }[] {
  return readdirSync(PACKAGES)
    .map((dir) => ({ dir, file: join(PACKAGES, dir, 'package.json') }))
    .filter(({ file }) => existsSync(file))
    .map(({ dir, file }) => ({ dir, pkg: JSON.parse(readFileSync(file, 'utf8')) as Manifest }))
    .sort((a, b) => a.dir.localeCompare(b.dir))
}

/** Resolve an installed package out of the pnpm store, so the fixture links real installs. */
function storePath(name: string): string | undefined {
  const store = join(REPO_ROOT, 'node_modules', '.pnpm')
  const prefix = `${name.replace('/', '+')}@`
  const dir = readdirSync(store)
    .filter((d) => d.startsWith(prefix))
    .sort()
    .at(-1)
  return dir === undefined ? undefined : join(store, dir, 'node_modules', name)
}

/**
 * A consumer project holding one package plus exactly what it DECLARES.
 *
 * Optional peers are linked too. They are declared, so a consumer who wants the entry that needs
 * one installs it — and leaving them out would make this fail for packages that are correct.
 */
function consumerFor(dir: string, pkg: Manifest): { root: string; unavailable: string[] } {
  const root = mkdtempSync(join(tmpdir(), `isolated-${dir}-`))
  created.push(root)
  writeFileSync(join(root, 'package.json'), '{"name":"probe","type":"module","private":true}')

  const target = join(root, 'node_modules', ...pkg.name.split('/'))
  mkdirSync(target, { recursive: true })
  for (const entry of ['dist', 'package.json']) {
    const from = join(PACKAGES, dir, entry)
    if (existsSync(from)) cpSync(from, join(target, entry), { recursive: true })
  }

  const unavailable: string[] = []
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]
  for (const name of declared) {
    const from = storePath(name)
    if (from === undefined) {
      // Reported, never passed over: a peer absent from the store would otherwise look exactly
      // like a peer the entry does not need.
      unavailable.push(name)
      continue
    }
    const to = join(root, 'node_modules', ...name.split('/'))
    mkdirSync(join(to, '..'), { recursive: true })
    if (!existsSync(to)) symlinkSync(from, to)
  }
  return { root, unavailable }
}

/** The runtime targets of a manifest's `exports`, as a consumer would import them. */
function loadableEntries(pkg: Manifest): { subpath: string; runtime: string }[] {
  const out: { subpath: string; runtime: string }[] = []
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (subpath.endsWith('package.json')) continue
    const runtime =
      typeof target === 'string'
        ? target
        : ((target as { import?: string } | null)?.import ?? undefined)
    if (runtime !== undefined) out.push({ subpath, runtime })
  }
  return out
}

describe('a published entry loads without the monorepo underneath it', () => {
  const all = manifests()

  it('finds packages at all, so the assertions below cannot pass vacuously', () => {
    expect(all.length).toBeGreaterThan(5)
  })

  for (const { dir, pkg } of all) {
    const entries = loadableEntries(pkg)
    if (entries.length === 0) continue

    describe(pkg.name, () => {
      for (const { subpath, runtime } of entries) {
        it(`loads ${subpath} with only its declared dependencies`, async () => {
          const { root, unavailable } = consumerFor(dir, pkg)
          const entry = pathToFileURL(
            join(root, 'node_modules', ...pkg.name.split('/'), normalize(runtime)),
          ).href

          let error: { code?: string; message?: string } | undefined
          let keys: string[] = []
          try {
            keys = Object.keys((await import(entry)) as Record<string, unknown>)
          } catch (err) {
            error = err as { code?: string; message?: string }
          }

          expect(
            error,
            `${pkg.name}${subpath.slice(1)} did not load from a consumer layout` +
              (unavailable.length > 0
                ? ` (declared but absent from the store, so not linked: ${unavailable.join(', ')})`
                : '') +
              `: ${error?.code ?? ''} ${error?.message ?? ''}`,
          ).toBeUndefined()
          expect(
            keys.length,
            `${pkg.name}${subpath.slice(1)} exports nothing at runtime`,
          ).toBeGreaterThan(0)
        }, 60_000)
      }
    })
  }
})
