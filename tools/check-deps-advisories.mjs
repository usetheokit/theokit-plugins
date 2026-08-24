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

/**
 * The GHSA ids `osv-scanner` reported, or `null` when it did not run.
 *
 * `rules/deps-audit-golden-rule.md § 5` names `npm audit` AND `osv-scanner` for npm, cross-checked.
 * Until 2026-08-24 only the first ran, and this gate said so rather than implying otherwise.
 *
 * The file is produced by CI (`osv-scanner scan source --lockfile pnpm-lock.yaml --format json`)
 * and read here; the scanner is not invoked from this script, so a machine without it keeps working
 * and reports itself single-sourced instead of failing.
 *
 * Both `id` and `aliases` are read: for npm packages OSV's own id is usually the GHSA, but not
 * always — matching on one field alone would manufacture disagreements out of a naming difference.
 */
function osvGhsaIds() {
  const path = process.env.OSV_RESULTS
  if (path === undefined || !existsSync(path)) return null
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    // Loud, never silent: a malformed file must not read as "the scanners agree".
    console.error(
      `[deps-advisories] x OSV_RESULTS at ${path} is not readable JSON: ${error.message}`,
    )
    return null
  }
  const ids = new Map()
  for (const result of parsed.results ?? []) {
    for (const pkg of result.packages ?? []) {
      for (const vuln of pkg.vulnerabilities ?? []) {
        for (const ident of [vuln.id, ...(vuln.aliases ?? [])]) {
          if (typeof ident === 'string' && ident.startsWith('GHSA-'))
            ids.set(ident, pkg.package.name)
        }
      }
    }
  }
  return ids
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

// The cross-check the golden rule names. A disagreement is REPORTED and not resolved toward either
// scanner: they read different databases on different refresh cycles, so one seeing something first
// is normal and neither is authoritative. Failing on any divergence would make the gate red for a
// reason nobody in this repository can act on — and a gate people cannot act on is a gate they
// route around.
//
// What it IS good for: the day one scanner stops seeing a whole class of package, this is what
// notices. Measured 2026-08-24, the two agree exactly — 29 GHSA ids each, zero either way — which
// is the baseline that makes a future divergence meaningful.
const osvIds = osvGhsaIds()
const coverage = []
if (osvIds === null) {
  coverage.push(
    '`osv-scanner` did not run — no OSV_RESULTS file. The golden rule names it as a cross-check for',
    'npm, so this run is single-sourced on `pnpm audit`.',
  )
} else {
  const auditIds = new Map()
  for (const advisory of Object.values(report.advisories)) {
    if (typeof advisory.github_advisory_id === 'string') {
      auditIds.set(advisory.github_advisory_id, advisory.module_name)
    }
  }
  const onlyAudit = [...auditIds.keys()].filter((id) => !osvIds.has(id)).sort()
  const onlyOsv = [...osvIds.keys()].filter((id) => !auditIds.has(id)).sort()

  coverage.push(
    `cross-checked against \`osv-scanner\`: ${auditIds.size} GHSA id(s) from \`pnpm audit\`, ` +
      `${osvIds.size} from OSV, ${onlyAudit.length + onlyOsv.length} disagreement(s).`,
  )
  for (const id of onlyAudit)
    coverage.push(`  only \`pnpm audit\` sees ${id} (${auditIds.get(id)})`)
  for (const id of onlyOsv) coverage.push(`  only \`osv-scanner\` sees ${id} (${osvIds.get(id)})`)
  if (onlyAudit.length + onlyOsv.length > 0) {
    coverage.push(
      '  Reported, not resolved: the two read different databases on different refresh cycles.',
    )
  }
}

process.exit(
  reportGate({
    label: 'deps-advisories',
    subject: 'advisories',
    checked: Object.keys(report.advisories).length,
    skipped: coverage,
  })
    ? 0
    : 1,
)
