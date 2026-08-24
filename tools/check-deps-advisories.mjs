/**
 * A HIGH advisory that ships is a defect; one that does not is a number.
 *
 * Measured 2026-08-24: `pnpm audit` reports 19 HIGH findings in this workspace, and **all nineteen
 * enter through a devDependency** — seventeen of them from the workspace root, which publishes
 * nothing. Not one reaches a consumer.
 *
 * That is why this gate does not fail on severity alone. A gate that went red on arrival, over
 * nineteen findings nobody could act on, would be allowlisted wholesale or deleted within a week —
 * leaving the repository worse off than before it existed. This one is green today, which is the
 * only condition under which its first red gets believed.
 *
 * The distinction is read from the MANIFESTS, never from a list of package names. An advisory path
 * looks like:
 *
 *     packages__plugin-canvas>jsdom>form-data
 *     └ origin                 └ first edge
 *
 * The first edge is what the origin package itself declares, so its section in that package's own
 * `package.json` decides whether the chain ships. A dependency moved from `devDependencies` to
 * `dependencies` changes the verdict here with no change to this file — which a name list could
 * never do.
 *
 * An undeclared first edge is treated as RUNTIME. It is the conservative side of an unknown: a
 * chain nobody can classify might ship, and a security gate should be loud about that rather than
 * quiet.
 *
 * If the audit cannot run, this exits non-zero saying so. A security check that goes green when its
 * input is missing is worse than no check, because the green is read as evidence.
 */
import { reportGate } from './lib/gate-summary.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))
const ROOT = process.env.DEPS_AUDIT_ROOT ?? REPO_ROOT

/** Origin segment -> that package's manifest path. `.` is the workspace root. */
function manifestFor(origin) {
  if (origin === '.') return join(ROOT, 'package.json')
  if (origin.startsWith('packages__')) {
    return join(ROOT, 'packages', origin.slice('packages__'.length), 'package.json')
  }
  return join(ROOT, origin, 'package.json')
}

const manifestCache = new Map()
function readManifest(path) {
  if (!manifestCache.has(path)) {
    manifestCache.set(path, existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null)
  }
  return manifestCache.get(path)
}

/**
 * Which section of the origin package's manifest declares the first edge.
 *
 * Returns 'runtime' when it ships, 'dev' / 'peer' when it does not, and 'undeclared' when the
 * manifest does not mention it — which the caller treats as runtime, deliberately.
 */
function classify(origin, firstEdge) {
  const manifest = readManifest(manifestFor(origin))
  if (manifest === null) return 'undeclared'
  if (manifest.dependencies?.[firstEdge] !== undefined) return 'runtime'
  if (manifest.devDependencies?.[firstEdge] !== undefined) return 'dev'
  if (manifest.peerDependencies?.[firstEdge] !== undefined) return 'peer'
  return 'undeclared'
}

/** Run the audit, or fail saying it did not run. */
function audit() {
  let raw
  try {
    raw = execFileSync('pnpm', ['audit', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // `pnpm audit` exits non-zero when it finds anything, which is the normal case here.
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (error) {
    raw = error.stdout ?? ''
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || parsed.advisories === undefined) {
      throw new TypeError('no `advisories` key')
    }
    return parsed
  } catch (error) {
    console.error(
      `[deps-advisories] FAIL — the audit did not run, so nothing was checked: ${error.message}`,
    )
    console.error(
      '  A security gate that passes when its input is missing reports absence as evidence.',
    )
    process.exit(1)
  }
}

const report = audit()
const shipping = []
const contained = []

for (const advisory of Object.values(report.advisories)) {
  if (advisory.severity !== 'high') continue
  for (const finding of advisory.findings ?? []) {
    for (const path of finding.paths ?? []) {
      const segments = path.split('>')
      const origin = segments[0]
      const firstEdge = segments[1] ?? segments[0]
      const kind = classify(origin, firstEdge)
      const row = { module: advisory.module_name, origin, firstEdge, kind, path }
      if (kind === 'runtime' || kind === 'undeclared') shipping.push(row)
      else contained.push(row)
    }
  }
}

for (const row of contained) {
  console.log(
    `[deps-advisories] i dev-chain: ${row.module} via ${row.origin} > ${row.firstEdge} (${row.kind})`,
  )
}

if (shipping.length > 0) {
  console.error(
    `\n[deps-advisories] FAIL — ${shipping.length} HIGH advisor(y|ies) reach a RUNTIME chain:`,
  )
  for (const row of shipping) {
    console.error(`      ${row.module} — ${row.path}`)
    console.error(
      `        ${row.origin} declares ${row.firstEdge} in ${row.kind === 'undeclared' ? 'no section this checker could find (treated as runtime)' : 'dependencies'}`,
    )
  }
  console.error('\n  These ship to consumers. Upgrade, or allowlist with a sunset per')
  console.error('  the deps-audit golden rule — never by widening this gate.')
  process.exit(1)
}

// `contained.length` is a FINDING count, not a checked count: zero HIGH advisories is a perfectly
// good outcome and says nothing about whether the audit examined anything. The advisory count is
// what makes the pass earned.
console.log(
  `\n[deps-advisories] ${contained.length} HIGH advisor(y|ies) found, none reaching a runtime chain.`,
)
process.exit(
  reportGate({
    label: 'deps-advisories',
    subject: 'advisories',
    checked: Object.keys(report.advisories).length,
    skipped: [
      '`osv-scanner` was not run (not installed); the golden rule names it as a cross-check for npm,',
      'so this run is single-sourced on `pnpm audit`.',
    ],
  })
    ? 0
    : 1,
)
