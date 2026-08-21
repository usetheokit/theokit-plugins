// The published declaration entries of every workspace package, resolved ONE way.
//
// Both documentation gates need this list and they must agree: the coverage gate measures what a
// consumer's editor can read, and the drift gate resolves the specifiers documentation tells that
// consumer to write. If the two disagreed about which files are published, a green run from either
// would mean something narrower than it claims.
//
// EVERY SUBPATH, NOT JUST `.`. This repository's packages publish up to four entries each
// (`@theokit/plugin-canvas`, `/ui`, `/server`; `@theokit/plugin-payments`, `/stripe`,
// `/abacatepay`). Measuring only `.` would leave eight of nineteen entries unmeasured while
// reporting a percentage that reads as whole-package coverage. The list is derived from each
// package's own `exports` field — the same map a consumer's resolver reads — so an entry cannot be
// published without the gates seeing it.
//
// Packages build ESM only, so `.d.ts` is the whole declaration surface; there is no `.d.cts` to
// check. `./package.json` is an export subpath but not a declaration, and is dropped.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The `types` target of one `exports` entry, whatever shape the entry takes. */
function typesTarget(value) {
  if (typeof value === 'string') return value.endsWith('.d.ts') ? value : undefined
  if (value === null || typeof value !== 'object') return undefined
  return typeof value.types === 'string' ? value.types : undefined
}

/**
 * @returns {Array<{name: string, dir: string, entries: Array<{specifier: string, decl: string}>,
 * built: boolean}>} one row per workspace package that has a manifest, in directory order.
 *
 * `built` is false when any declared entry is missing from `dist/` — reported by the caller rather
 * than skipped, because a gate whose green can mean "there was nothing to check" is not a gate.
 * A directory with no `package.json` (`packages/plugin-mdx` is a placeholder holding only
 * `.gitkeep`) publishes nothing and is not a package yet.
 */
export function publishedPackages() {
  const packagesDir = join(ROOT, 'packages')
  const rows = []
  for (const name of readdirSync(packagesDir).sort()) {
    const dir = join(packagesDir, name)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    const meta = JSON.parse(readFileSync(manifest, 'utf8'))
    const entries = []
    let built = true
    for (const [subpath, value] of Object.entries(meta.exports ?? {})) {
      const target = typesTarget(value)
      if (target === undefined) continue
      const decl = join(dir, target)
      if (!existsSync(decl)) built = false
      entries.push({
        specifier: subpath === '.' ? meta.name : `${meta.name}/${subpath.replace(/^\.\//, '')}`,
        decl,
      })
    }
    rows.push({ name: meta.name, dir, entries, built: built && entries.length > 0 })
  }
  return rows
}

/** Every published specifier mapped to the declaration file it resolves to. */
export function publishedSpecifiers() {
  const map = new Map()
  for (const pkg of publishedPackages()) {
    for (const entry of pkg.entries) map.set(entry.specifier, entry.decl)
  }
  return map
}
