#!/usr/bin/env node
/**
 * Manifest gate for every publishable package under packages/.
 *
 * Each rule here exists because its absence cost a real release, and each one is
 * invisible until the worst possible moment — the first publish of a package.
 * That is the whole point of checking them on every push instead.
 *
 *   1. `repository` with a matching `directory`
 *      npm validates the repository the signed provenance claims against the
 *      package's own `repository.url`. With the field missing the comparison runs
 *      against an empty string and the registry rejects the upload:
 *
 *        E422 ... Failed to validate repository information: package.json:
 *        "repository.url" is "", expected to match
 *        "https://github.com/usetheokit/theokit-plugins" from provenance
 *
 *      Nine of eleven packages shipped without it (#34). `plugin-canvas` published
 *      in the same run where `plugin-forms` failed purely because it had the field.
 *      `directory` is required too: this is a monorepo, and without it the npm page
 *      points at the repository root instead of the package.
 *
 *   2. No `link:` or `file:` dependency escaping the workspace
 *      `"theokit": "link:../../../theokit/packages/theo"` in nine packages made all
 *      three CI jobs impossible to pass on any commit — the path exists on one
 *      machine and no runner (#13). It stayed invisible for months because CI did
 *      not run on the promotion that introduced it (#11).
 *
 *   3. `publishConfig.provenance` on anything published
 *      The release workflow sets NPM_CONFIG_PROVENANCE globally, so a package
 *      missing this still gets provenance today. It is declared per package anyway
 *      so the guarantee survives someone publishing by hand — which is how the
 *      nine 2026-07-10 versions reached the registry, all without attestations.
 *
 * Exits non-zero listing every violation, so one run tells you everything rather
 * than one thing per run.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const EXPECTED_REPO_URL = 'git+https://github.com/usetheokit/theokit-plugins.git'
const PACKAGES_DIR = 'packages'

/**
 * Any `link:` or `file:` range is a violation. Internal dependencies in a pnpm
 * workspace are declared `workspace:*`, so these protocols only ever appear here
 * pointing at somebody's disk — and no package currently uses either, so nothing
 * legitimate is being outlawed.
 *
 * The first version of this check tried to allow "internal" links by exempting
 * ranges starting with `link:.`, which silently exempted
 * `link:../../../theokit/packages/theo` — the exact string from #13, since `..`
 * starts with `.`. It passed the adversarial test it was written for. Hence the
 * blanket rule: a gate with a carve-out nobody needs is a gate with a hole.
 */
const LOCAL_PATH_PROTOCOL = /^(link|file):/

const violations = []

function check(dir) {
  const manifestPath = join(PACKAGES_DIR, dir, 'package.json')
  if (!existsSync(manifestPath)) return

  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const where = `${manifestPath} (${pkg.name ?? dir})`

  // Private packages are never published, so provenance and repository do not apply.
  if (pkg.private === true) return

  const repositoryUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  if (!repositoryUrl) {
    violations.push(
      `${where}: missing "repository" — npm rejects the publish with E422 when provenance cannot be matched against it`,
    )
  } else if (repositoryUrl !== EXPECTED_REPO_URL) {
    violations.push(
      `${where}: "repository.url" is ${JSON.stringify(repositoryUrl)}, expected ${JSON.stringify(EXPECTED_REPO_URL)}`,
    )
  }

  const expectedDirectory = `${PACKAGES_DIR}/${dir}`
  if (repositoryUrl && pkg.repository?.directory !== expectedDirectory) {
    violations.push(
      `${where}: "repository.directory" is ${JSON.stringify(pkg.repository?.directory)}, expected ${JSON.stringify(expectedDirectory)}`,
    )
  }

  if (pkg.publishConfig?.provenance !== true) {
    violations.push(
      `${where}: missing "publishConfig.provenance": true — a hand publish would ship without attestations`,
    )
  }

  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (typeof range === 'string' && LOCAL_PATH_PROTOCOL.test(range)) {
        violations.push(
          `${where}: ${field}.${name} is ${JSON.stringify(range)} — a local path resolves to nothing in CI; use a registry range, or workspace:* for an internal package`,
        )
      }
    }
  }
}

for (const dir of readdirSync(PACKAGES_DIR).sort()) check(dir)

if (violations.length > 0) {
  console.error(`✗ ${violations.length} manifest violation(s):\n`)
  for (const v of violations) console.error(`  ${v}`)
  console.error('')
  process.exit(1)
}

console.log(
  '✓ every package manifest is publishable (repository + directory, provenance, no escaping local paths)',
)
