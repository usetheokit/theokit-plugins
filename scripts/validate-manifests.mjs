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
 *   4. An honest `theokit` peer dependency, and no re-invented framework types
 *      Eleven packages declared `theokit` as a peer; measured 2026-08-18, nine
 *      imported nothing from it, and two declared their OWN `TheoPluginApp`
 *      describing methods the framework does not have — `registerRoute`,
 *      `hasRoute`, `registerCliCommand`, `registerDevtoolsTab`. Both type-checked,
 *      because TypeScript is structural and the parameter was never used (#42).
 *
 *      In `plugin-db-drizzle` the `register()` body actually CALLED them behind
 *      `if (app.registerCliCommand)` guards, so seven documented CLI verbs and a
 *      devtools tab were a silent no-op for several releases (#43).
 *
 *      A peer nobody imports is a claim nobody checks, and a locally invented
 *      framework interface is a fabricated citation in type form. Both are cheap
 *      to detect and impossible to notice by reading.
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

/**
 * Names the framework owns. A package declaring one of these locally is
 * re-inventing a contract it could import, and nothing makes the invention match
 * (#42). `import type` is erased at build, so importing the real one costs
 * nothing at runtime — `plugin-voice` has done exactly that all along.
 */
const FRAMEWORK_OWNED_TYPES = ['TheoPluginApp', 'TheoApp', 'TheoPlugin']

/**
 * Packages allowed to declare a `theokit` peer without referencing it, each with
 * the reason and the shape of the work that would remove the exemption.
 *
 * This is a triage list, not a suppression list. It exists because #42 asks for a
 * DECISION per package rather than a blanket rewrite: some of these have a real
 * server surface worth publishing on `ctx`, and one has none at all. An entry
 * here means somebody looked; an absent entry means the gate refuses.
 */
const PEER_WITHOUT_USE_EXEMPT = {
  'auth-github': {
    theokit:
      'Exchange + fetch helpers a route handler calls directly. Publishing them on ctx is the natural adapter step — see #42 item 2.',
  },
  'auth-magic-link': {
    theokit:
      'Same shape as auth-github: token issue/verify helpers called from the consumer route.',
  },
  'plugin-email': {
    theokit:
      'Holds an EmailProvider — the closest analogue to what plugin-payments now publishes on ctx.payments.',
  },
  'plugin-realtime': {
    theokit:
      'Providers are in-memory and Yjs; never imports @theokit/sdk either, so it opens no socket. Adapter value unclear — measure before deciding.',
  },
}

/**
 * The lowest version a simple range admits: `^0.48.7` and `>=0.48.7` both yield `0.48.7`.
 *
 * Deliberately not a semver-range parser. The manifests in this repository use exactly these two
 * forms, and a partial parser that silently mishandled a third would be worse than one that
 * refuses: `null` means "cannot read this", and the caller skips rather than guesses.
 */
function rangeFloor(range) {
  const match = /^(?:\^|~|>=)?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(range.trim())
  if (match === null) return null
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  }
}

/** True when `a` is strictly below `b`. A prerelease sorts below the same release. */
function isBelow(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] < b.parts[i]
  }
  if (a.prerelease === b.prerelease) return false
  if (a.prerelease !== null && b.prerelease === null) return true
  return false
}

const violations = []

function check(dir) {
  const manifestPath = join(PACKAGES_DIR, dir, 'package.json')
  if (!existsSync(manifestPath)) return

  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const where = `${manifestPath} (${pkg.name ?? dir})`

  // Rule 4 runs BEFORE the private-package early return: a fabricated framework
  // type and a decorative peer are wrong whether or not the package publishes.
  checkFrameworkContract(dir, pkg, where)

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

/**
 * Rule 4. Read the SOURCE, not the built output: a package can be honest without
 * shipping the type in its `.d.ts` (auth-google imports values from
 * `theokit/server/auth`), and `dist/` may be stale or absent on a fresh clone.
 */
function checkFrameworkContract(dir, pkg, where) {
  const srcDir = join(PACKAGES_DIR, dir, 'src')
  if (!existsSync(srcDir)) return

  const sources = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) sources.push(full)
    }
  }
  walk(srcDir)

  // Every framework peer, not just `theokit`. The check covered exactly one name, so a
  // decorative `@theokit/*` peer was invisible to it — and a peer nobody imports still drags
  // its dependency tree into the consumer's resolution, which is what made plugin-forms
  // impossible to install (#64, #66).
  const frameworkPeers = Object.keys(pkg.peerDependencies ?? {}).filter(
    (name) => name === 'theokit' || name.startsWith('@theokit/'),
  )
  const imported = new Set()

  for (const file of sources) {
    const text = readFileSync(file, 'utf8')
    // A real reference is an import specifier. A name inside a comment or a string is not
    // one — which is how plugin-canvas read as a consumer of the framework while only
    // mentioning it in a JSDoc example.
    for (const peer of frameworkPeers) {
      const escaped = peer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\bfrom\\s+['"]${escaped}(\\/[^'"]*)?['"]`).test(text)) imported.add(peer)
    }

    // Same lesson as the import check above, applied where it was missing: prose is not
    // code. `type TheoApp` inside a comment explaining this very rule tripped it, and a
    // gate that fires on its own documentation teaches people to stop writing the
    // documentation. Comments are stripped before the test; a re-export
    // (`export type { TheoApp } from …`) is not a declaration either and never was.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    for (const owned of FRAMEWORK_OWNED_TYPES) {
      const declared = new RegExp(`\\b(interface|type)\\s+${owned}\\b`).test(
        code.replace(new RegExp(`export\\s+type\\s*\\{[^}]*\\}`, 'g'), ' '),
      )
      if (declared) {
        // `TheoPluginApp` gets a different message on purpose: it is not a
        // theokit export at all, it is the invented name (#42). Telling someone
        // to import it would send them looking for something that never existed
        // — the same mistake, one level up.
        const advice =
          owned === 'TheoPluginApp'
            ? "no such type exists in theokit — the app passed to register() is `TheoApp`, with `addHook` and `decorateRequest`. Use `import type { TheoApp } from 'theokit/server'`"
            : `import it instead: \`import type { ${owned} } from 'theokit/server'\` (erased at build, so no runtime coupling)`
        violations.push(`${where}: ${file} declares \`${owned}\` locally — ${advice}. See #42.`)
      }
    }
  }

  const exempt = PEER_WITHOUT_USE_EXEMPT[dir] ?? {}

  for (const peer of frameworkPeers) {
    if (imported.has(peer)) {
      if (peer in exempt) {
        violations.push(
          `${where}: imports \`${peer}\` AND is exempted for it — the exemption is stale, remove ${peer} from PEER_WITHOUT_USE_EXEMPT['${dir}'].`,
        )
      }
      continue
    }
    if (peer in exempt) continue
    violations.push(
      `${where}: declares a \`${peer}\` peerDependency and imports nothing from it. A peer nobody imports still drags its dependency tree into the consumer's resolution (#64). Either use it or drop it — or add it to PEER_WITHOUT_USE_EXEMPT['${dir}'] with the reason. See #42 item 3, #66.`,
    )
  }

  // A peer floor below what the package is BUILT against is a promise nobody checked. Six
  // packages imported `theokit` and declared floors from >=0.1.0-alpha.5 to >=0.4.0-beta.0,
  // ranges spanning the framework's builder-API change: the code does not compile against the
  // versions they admit, and the failure lands in the consumer's build pointing at us (#69).
  const devFloorRange = pkg.devDependencies?.theokit
  const peerFloorRange = pkg.peerDependencies?.theokit
  if (typeof devFloorRange === 'string' && typeof peerFloorRange === 'string') {
    const devFloor = rangeFloor(devFloorRange)
    const peerFloor = rangeFloor(peerFloorRange)
    if (devFloor !== null && peerFloor !== null && isBelow(peerFloor, devFloor)) {
      violations.push(
        `${where}: peerDependencies.theokit is ${JSON.stringify(peerFloorRange)} but the package is built against ${JSON.stringify(devFloorRange)} — the range admits versions nothing here compiles against. Raise the floor, or add a CI job that builds this package against it. See #69.`,
      )
    }
  }

  for (const peer of Object.keys(exempt)) {
    if (!frameworkPeers.includes(peer)) {
      violations.push(
        `${where}: exempted for \`${peer}\` but declares no such peer — the exemption is stale, remove it.`,
      )
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
  '✓ every package manifest is publishable (repository + directory, provenance, no escaping local paths)\n' +
    '✓ no package re-invents a theokit type, and every `theokit`/`@theokit/*` peer is used or triaged',
)
