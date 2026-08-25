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
import { reportGate } from '../tools/lib/gate-summary.mjs'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import semver from 'semver'
import ts from 'typescript'

import { splitFences } from '../tools/lib/markdown-fences.mjs'

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

/**
 * A peer range on the framework must not carry a ceiling nobody typed.
 *
 * `^0.48.7` reads like "0.48.7 or newer" and is not. Under semver, a caret on a `0.x` version
 * pins the MINOR: it expands to `>=0.48.7 <0.49.0`. So the day `theokit` published `0.50.0` —
 * 2026-08-24 — `@theokit/plugin-forms` stopped being installable alongside `theokit@latest`,
 * while the other ten packages, which declare `>=0.48.7`, were unaffected.
 *
 * Nothing announced it. `rangeFloor` above compares floors, and the floor was fine; the defect
 * was entirely in a bound the author never wrote down. It surfaces in a consumer's install, not
 * here, which is the same asymmetry `rules/decoration-keys.md` records for decoration keys.
 *
 * This is about a peer on a `0.x` framework specifically. `^1.2.3` admits every `1.x`, which is
 * the intent people expect from a caret and is left alone. Below 1.0.0 the same character means
 * "patch only", and for a framework releasing minors that is a pin with a disguise.
 */
function ceilingIsBelowNextMajor(range) {
  const match = /^([\^~])(\d+)\.(\d+)\.(\d+)/.exec(range.trim())
  if (match === null) return null
  const [, operator, major] = match
  // `~` pins the minor at every major; `^` only does so below 1.0.0.
  if (operator === '~' || Number(major) === 0) return operator
  return null
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

  for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (peer !== 'theokit' && !peer.startsWith('@theokit/')) continue
    const operator = ceilingIsBelowNextMajor(range)
    if (operator !== null) {
      violations.push(
        `${where}: peer "${peer}": ${JSON.stringify(range)} carries a ceiling nobody typed — ` +
          `"${operator}" on a 0.x version pins the MINOR, so the next framework minor release ` +
          'silently stops satisfying it. Use ">=" unless the pin is deliberate.',
      )
    }
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

  // A peer range that admits versions the package is not BUILT against is a promise nobody
  // checked, and it fails in the CONSUMER's build while naming our package. Both ends drift:
  //
  //   floor too low  — six packages imported `theokit` with floors from >=0.1.0-alpha.5 to
  //                    >=0.4.0-beta.0, spanning the framework's builder-API change (#69)
  //   no ceiling     — four declared `@theokit/sdk: >=2.18.0` while the SDK shipped 4.53.1,
  //                    two majors past what their devDependency pins (#107)
  //
  // Checked for every framework peer that has a devDependency to compare against; a peer with
  // no devDependency is not compiled here at all, so there is nothing to measure it by.
  for (const peer of frameworkPeers) {
    const devRange = pkg.devDependencies?.[peer]
    const peerRange = pkg.peerDependencies?.[peer]
    if (typeof devRange !== 'string' || typeof peerRange !== 'string') continue

    const devFloor = rangeFloor(devRange)
    const peerFloor = rangeFloor(peerRange)
    if (devFloor === null || peerFloor === null) continue

    if (isBelow(peerFloor, devFloor)) {
      violations.push(
        `${where}: peerDependencies["${peer}"] is ${JSON.stringify(peerRange)} but the package is built against ${JSON.stringify(devRange)} — the range admits versions BELOW what compiles here. Raise the floor, or add a CI job that builds this package against it. See #69.`,
      )
    }

    // NOT checked here: whether an unbounded `>=X` admits a version the devDependency's `^X`
    // would exclude. It is the same defect as the floor — a promise nothing measures — but
    // whether it is currently FALSE depends on what the registry has published, and this gate
    // runs offline. Measured 2026-08-22: `>=2.18.0` on @theokit/sdk admitted 4.53.1, two majors
    // past the compiled ^2.18.0, and was narrowed (#107); `theokit >=0.48.7` and
    // `@theokit/react >=1.1.0` admitted nothing their caret ranges did not, so flagging them
    // would be a gate firing on something that is not yet wrong — which is how a gate teaches
    // people to skip it.
  }

  for (const peer of Object.keys(exempt)) {
    if (!frameworkPeers.includes(peer)) {
      violations.push(
        `${where}: exempted for \`${peer}\` but declares no such peer — the exemption is stale, remove it.`,
      )
    }
  }
}

/**
 * Request-decoration keys, and why a duplicate is a build failure.
 *
 * Measured against theokit 0.48.8: two plugins with distinct names claiming one key are BOTH
 * registered without error, and `applyDecorations` does `ctx[key] = value` across scopes in
 * registration order — so a handler reads whatever the last-registered plugin wrote, and the
 * first plugin's decoration is gone. `DuplicateDecorationError` is exported but constructed
 * nowhere; the runner's comment records the permissiveness as deliberate. Nothing else in this
 * repository reads decoration keys, so this is the only place a collision is catchable before it
 * reaches a consumer's app — where the symptom moves when they reorder their own config.
 *
 * Parsed with the TypeScript compiler rather than matched with a regex. That is not taste: a
 * regex here matched a comment (#99) and `Buffer.from('crypto')` (#84) in this repository, and
 * both were replaced with the compiler. The file's own framework-contract rule carries the same
 * lesson a few lines up — prose is not code.
 */
const DECORATION_METHOD = 'decorateRequest'

/** Every `.ts`-family source under a package. */
function sourceFiles(dir) {
  const srcDir = join(PACKAGES_DIR, dir, 'src')
  if (!existsSync(srcDir)) return []
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      // Test and fixture files are excluded: a colocated fake app calling its own
      // `decorateRequest` is not a claim on the shared namespace, and counting it would fail a
      // repository with no real collision. `rules/testing.md § 5.1` puts unit tests in
      // `packages/*/tests`, so today this excludes nothing — it is the guard for the first
      // package that colocates one.
      else if (/\.(test|spec|fixture|mock)\.(ts|tsx|mts|cts)$/.test(entry.name)) continue
      else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full)
    }
  }
  walk(srcDir)
  return out
}

/**
 * Resolve a node to the string it will be at runtime, or `null`.
 *
 * Handles the forms that actually occur: a literal, a template with no substitutions, a
 * concatenation of resolvable parts, an `as const` assertion, and an identifier declared anywhere
 * in the same package. Everything else — a property access, a call, a template with holes — is
 * `null`, which is REPORTED rather than dropped, and which makes the summary line say so.
 */
function resolveString(node, source, literals) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  // `'payments' as const` is idiomatic TypeScript and wraps the literal in an AsExpression.
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression?.(node))
    return resolveString(node.expression, source, literals)
  if (ts.isParenthesizedExpression(node)) return resolveString(node.expression, source, literals)
  if (ts.isIdentifier(node)) return literals.has(node.text) ? literals.get(node.text) : null
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveString(node.left, source, literals)
    const right = resolveString(node.right, source, literals)
    return left !== null && right !== null ? left + right : null
  }
  return null
}

/**
 * Keys claimed by one package.
 *
 * Resolution follows the CALL SITE, not the exported const name: what matters is the value handed
 * to the framework, so a package declaring one name and passing another is measured by what it
 * passes.
 *
 * Identifiers resolve against a map built from the WHOLE package, not from the calling file. That
 * distinction is the difference between a gate and a decoration: with same-file-only resolution,
 * moving `PAYMENTS_DECORATION_KEY` into its own module — an ordinary refactor — silently turned a
 * real collision into an unresolved line and the run still printed a green summary.
 */
function decorationKeys(dir) {
  const files = sourceFiles(dir)
  const parsed = files.map((file) => ({
    file,
    source: ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
  }))

  // Pass 1: every `const NAME = <resolvable>` in the package. Comments are not nodes, so a name
  // that appears only in prose never lands here.
  //
  // `exported` is tracked separately from `literals` rather than folded into it. The convention has
  // two halves — the key is an identifier, AND that identifier is importable — and a check that
  // collapsed them would accept a module-local const: an identifier at the call site, and still a
  // key no consumer can import, which is the whole thing the convention is for.
  //
  // The `export` modifier sits on the VariableStatement, two levels above the declaration, so it is
  // read from the declaration list's parent rather than from the declaration itself.
  const literals = new Map()
  const exported = new Set()
  for (const { source } of parsed) {
    const collect = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const value = resolveString(node.initializer, source, literals)
        if (value !== null) {
          literals.set(node.name.text, value)
          const statement = node.parent?.parent
          const isExported =
            statement !== undefined &&
            ts.isVariableStatement(statement) &&
            (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0
          if (isExported) exported.add(node.name.text)
        }
      }
      ts.forEachChild(node, collect)
    }
    collect(source)
  }

  // Pass 2: the call sites.
  const resolved = []
  const unresolved = []
  for (const { file, source } of parsed) {
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression
        const isDecorate =
          (ts.isPropertyAccessExpression(callee) && callee.name.text === DECORATION_METHOD) ||
          // `app['decorateRequest'](…)` is the one bypass that would otherwise leave no trace:
          // element access is not a PropertyAccessExpression, so it was neither counted nor
          // reported.
          (ts.isElementAccessExpression(callee) &&
            callee.argumentExpression &&
            ts.isStringLiteral(callee.argumentExpression) &&
            callee.argumentExpression.text === DECORATION_METHOD)

        if (isDecorate) {
          const arg = node.arguments[0]
          const line = source.getLineAndCharacterOfPosition(arg.getStart(source)).line + 1
          const value = resolveString(arg, source, literals)
          if (value !== null) {
            // The FORM is read from the AST node, before resolution. After resolution `'stripe'`
            // and `STRIPE_DECORATION_KEY` are the same string — which is correct for collision
            // detection and blind to the thing this rule is about.
            const form = ts.isIdentifier(arg)
              ? exported.has(arg.text)
                ? 'exported-const'
                : 'local-const'
              : 'literal'
            resolved.push({ key: value, at: `${file}:${line}`, form, text: arg.getText(source) })
          } else unresolved.push({ at: `${file}:${line}`, text: arg.getText(source) })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  return { resolved, unresolved }
}

function checkDecorationKeys(dirs) {
  const claims = new Map()
  const unresolvedKeys = new Set()

  for (const dir of dirs) {
    const { resolved, unresolved } = decorationKeys(dir)
    for (const { key, at } of resolved) {
      if (!claims.has(key)) claims.set(key, new Map())
      // Keyed by package, so the same key claimed twice INSIDE one package is not a collision.
      // Deriving the package from `dir` rather than re-parsing the path also keeps this correct
      // on Windows, where `join()` emits `\\` and splitting on `/` collapsed every site to
      // `undefined` — making the check silently unable to fire.
      if (!claims.get(key).has(dir)) claims.get(key).set(dir, at)
    }
    // Reported, never dropped — and de-duplicated, because one unresolved identifier used three
    // times produced three byte-identical lines.
    for (const { at, text } of unresolved) unresolvedKeys.add(`${at}: \`${text}\``)

    // The form rule fires only on keys the parser FULLY resolved. An unresolvable key keeps the
    // `ℹ` channel above, which is an honest report of a blind spot; a literal is not a blind spot,
    // the parser knows exactly what it is. Failing both the same way would blur the two, and the
    // blind-spot channel is the one that has to stay readable.
    for (const { key, at, form, text } of resolved) {
      if (form === 'literal') {
        violations.push(
          `decoration key \`${key}\` is passed as a string literal at ${at} — declare it as an ` +
            `exported const beside the plugin so a consumer can import it instead of retyping it. ` +
            `A retyped key that is mistyped reads as \`undefined\` at request time, silently. ` +
            `See rules/decoration-keys.md § 2.`,
        )
      } else if (form === 'local-const') {
        violations.push(
          `decoration key \`${key}\` is passed as \`${text}\` at ${at}, which is a const that is ` +
            `not exported — a consumer still cannot import it. Add \`export\`. ` +
            `See rules/decoration-keys.md § 2.`,
        )
      }
    }
  }

  for (const line of [...unresolvedKeys].sort()) {
    console.error(`  \u2139 unresolved decoration key at ${line} — not compared for duplicates`)
  }

  for (const [key, byPackage] of claims) {
    if (byPackage.size > 1) {
      violations.push(
        `decoration key \`${key}\` is claimed by ${byPackage.size} packages: ${[...byPackage.values()].join(', ')} — ` +
          `the framework does not refuse this, it silently keeps the last one registered. ` +
          `See rules/decoration-keys.md.`,
      )
    }
  }

  return { compared: claims.size, unresolved: unresolvedKeys.size }
}

/**
 * A package that declares a seam must name that seam's factory in its README.
 *
 * Measured on `plugin-copilot`: it is declared `seam: 'plugin'`, its `register()` decorates the
 * request, and the conformance suite proves the real runner accepts it — while `copilot(`,
 * `plugins:` and `theo.config` appeared ZERO times in its README, and its npm description named
 * `defineCopilot` instead. A developer following that documentation exports a `defineCopilot` and
 * stops: the plugin is never registered, and nothing fails, because an unregistered plugin is
 * indistinguishable from one nobody wrote.
 *
 * This asserts PRESENCE, not correctness. A README naming the factory once in passing satisfies
 * it. That false negative is deliberate: encoding one documentation shape would fail packages that
 * legitimately document differently, and a gate people work around is worse than a floor.
 */
const SEAM_REGISTRY = join('integration', 'src', 'integrating-packages.ts')

/** `{ pkg, seam, factory }` rows read from the registry's AST. */
function parseSeamRegistry() {
  if (!existsSync(SEAM_REGISTRY)) return null
  const source = ts.createSourceFile(
    SEAM_REGISTRY,
    readFileSync(SEAM_REGISTRY, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  // Anchored to the INTEGRATING_PACKAGES declaration, not to "any object literal with pkg and
  // seam". The unanchored walk harvested example objects from helpers and JSDoc, which either
  // invented a violation naming a package that does not exist, or — with `seam: 'none'` —
  // silently inflated the row count that the vacuous-pass guard trusts.
  let elements = null
  const findDeclaration = (node) => {
    if (
      elements === null &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'INTEGRATING_PACKAGES' &&
      node.initializer
    ) {
      // `Object.freeze([...])` or a bare array literal.
      const init = node.initializer
      const array = ts.isArrayLiteralExpression(init)
        ? init
        : ts.isCallExpression(init) &&
            init.arguments.length &&
            ts.isArrayLiteralExpression(init.arguments[0])
          ? init.arguments[0]
          : null
      if (array) elements = array.elements
    }
    ts.forEachChild(node, findDeclaration)
  }
  findDeclaration(source)
  if (elements === null) return null

  const rows = []
  for (const element of elements) {
    if (!ts.isObjectLiteralExpression(element)) continue
    const row = {}
    for (const prop of element.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
      if (ts.isStringLiteral(prop.initializer)) row[prop.name.text] = prop.initializer.text
      else row[prop.name.text] = { unresolved: prop.initializer.getText(source) }
    }
    rows.push(row)
  }
  return rows
}

function checkSeamDocumentation(dirs) {
  const rows = parseSeamRegistry()
  if (rows === null) {
    // Absence is not corruption. A repository with no seam registry has not declared any seams —
    // a fresh checkout, or a fixture testing a different invariant — and failing it would couple
    // this check to every other check's fixtures. It is REPORTED rather than passed over: the
    // summary says `0 checked`, so a registry that disappeared from THIS repository shows up as
    // the count dropping from 7, not as silence.
    console.error(
      `  \u2139 no seam registry at ${SEAM_REGISTRY} — no package documents a declared seam`,
    )
    return { checked: 0, registry: false }
  }

  // An empty or partial parse must FAIL, not pass quietly. The sibling decoration-key check
  // shipped printing a green summary having resolved nothing, and that is the defect being
  // deliberately not repeated: a parse that finds fewer rows than there are packages means the
  // registry's shape moved, and every assertion below would then be vacuous.
  const onDisk = new Set(dirs.filter((d) => existsSync(join(PACKAGES_DIR, d, 'package.json'))))
  const registered = new Set(rows.map((r) => r.pkg).filter((p) => typeof p === 'string'))
  const unregistered = [...onDisk].filter((d) => !registered.has(d))
  if (unregistered.length > 0) {
    // Compared as SETS, not counts. A stale row for a deleted package used to pay for a live
    // package with no row at all — the counts matched, the guard stayed quiet, and the live
    // package was never checked. The number reported is the one actually compared.
    violations.push(
      `${SEAM_REGISTRY} has no row for ${unregistered.length} package(s) with a manifest: ` +
        `${unregistered.join(', ')} — every seam-documentation assertion for them would be vacuous.`,
    )
    return { checked: 0, registry: true }
  }

  let checked = 0
  for (const row of rows) {
    // A field the AST could not resolve to a literal (`seam: PLUGIN`) is a row this check cannot
    // reason about. Reported, never skipped: a dropped row is an unchecked package.
    for (const [field, value] of Object.entries(row)) {
      if (value && typeof value === 'object' && 'unresolved' in value) {
        violations.push(
          `${SEAM_REGISTRY}: a row's \`${field}\` is \`${value.unresolved}\`, not a string literal — ` +
            `this check reads literals, so that row would go unexamined.`,
        )
      }
    }
    if (row.seam === 'none') continue
    if (!row.factory) {
      violations.push(
        `${row.pkg}: declares seam \`${row.seam}\` but the registry names no factory for it — ` +
          `there is nothing to look for in its README.`,
      )
      continue
    }
    const readme = join(PACKAGES_DIR, row.pkg, 'README.md')
    if (!existsSync(readme)) {
      violations.push(`${row.pkg}: declares seam \`${row.seam}\` and has no README.`)
      continue
    }
    checked += 1
    if (!readmeCode(readme).includes(`${row.factory}(`)) {
      violations.push(
        `${row.pkg}: no code block in the README calls \`${row.factory}()\`, the factory whose ` +
          `result goes into the \`${row.seam}\` seam — a consumer following it gets an integration ` +
          `that looks wired and is not. A prose mention does not count: it satisfies a search and ` +
          `shows the reader nothing to copy. (Presence in code is the floor, not proof the docs ` +
          `are good.)`,
      )
    }
  }
  return { checked, registry: true }
}

/**
 * The fenced code blocks of a README, concatenated.
 *
 * Prose is excluded deliberately. A sentence saying "`copilot()` returns a TheoPlugin" satisfies a
 * substring search while showing a reader nothing they can copy — measured: deleting the wiring
 * example from `plugin-copilot`'s README left exactly that sentence behind, and a
 * presence-anywhere check stayed green.
 *
 * The scanner itself lives in `tools/lib/markdown-fences.mjs`, shared with the CHANGELOG
 * release-drift gate, which needs the other half of the same split — is this `## 2026-08-23` a
 * real heading, or an example inside a fence? Two implementations of one parser is how one of
 * them ends up being the buggy one nobody noticed.
 */
function readmeCode(path) {
  return splitFences(readFileSync(path, 'utf8')).code.join('\n')
}

/**
 * A declared peer range must admit the version this repository actually builds against.
 *
 * Every peer rule above is scoped to `theokit` and `@theokit/*`, so a THIRD-PARTY peer was checked
 * by nothing. Measured 2026-08-25, `plugin-realtime` declared `lib0: "^1"`:
 *
 *   $ npm view lib0 version              -> 0.2.117
 *   $ npm view lib0 versions --json      -> the only 1.x are 1.0.0-0 and 1.0.0-rc.0 … rc.26
 *
 * There is no stable 1.0.0. `^1` carries no prerelease, and semver excludes prereleases from such
 * a range, so it matched NOTHING a consumer could install — while `yjs@13.6.32` depends on
 * `lib0@^0.2.99` and `y-protocols@1.0.7` on `^0.2.85`, putting the whole ecosystem on 0.2.x.
 *
 * The mechanism is worth naming because it is invisible by reading: the devDependency said
 * `^1.0.0-rc.1`, which DOES match the rc line, so the package installed and compiled here while
 * the peer it published could not be satisfied by anyone. The same asymmetry as #158 — verified
 * against a devDependency nobody else installs.
 *
 * Comparing against the INSTALLED version rather than the devDependency range is what catches it:
 * the previous floor check compares two ranges and `^1`'s floor (1.0.0) sits ABOVE `^1.0.0-rc.1`'s,
 * which reads as a package being conservative rather than as one promising a version that does not
 * exist.
 *
 * Offline by construction: it asks the workspace what is on disk, never the registry. The cost is
 * that a peer with nothing installed cannot be measured at all, which is reported rather than
 * counted as a pass.
 */
function checkPeerRangesAgainstInstalled(dirs) {
  let compared = 0
  const unmeasured = []

  for (const dir of dirs) {
    const manifestPath = join(PACKAGES_DIR, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const where = `packages/${dir}/package.json`

    for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {})) {
      const installedManifest = join(PACKAGES_DIR, dir, 'node_modules', peer, 'package.json')
      if (!existsSync(installedManifest)) {
        // Nothing is installed for it here, so this repository never builds against it. Saying so
        // is the honest outcome; treating it as a pass would report coverage the run did not have.
        unmeasured.push(`${dir} → ${peer} (${range})`)
        continue
      }

      const installed = JSON.parse(readFileSync(installedManifest, 'utf8')).version
      if (typeof installed !== 'string') {
        unmeasured.push(`${dir} → ${peer} (no version in the installed manifest)`)
        continue
      }

      compared += 1
      if (semver.validRange(range) === null) {
        unmeasured.push(`${dir} → ${peer} (${range} is not a range semver can parse)`)
        compared -= 1
        continue
      }
      if (!semver.satisfies(installed, range)) {
        violations.push(
          `${where}: peerDependencies[${JSON.stringify(peer)}] is ${JSON.stringify(range)}, ` +
            `but the version this repository builds against is ${installed}, which the range does ` +
            `NOT admit. A consumer installing the published package cannot reproduce what we test ` +
            `— and when no published version satisfies the range at all, they cannot install it. ` +
            `Widen the peer to the version in devDependencies, or build against one the peer admits.`,
        )
      }
    }
  }

  if (unmeasured.length > 0) {
    for (const line of unmeasured) {
      console.error(`  ℹ peer not installed here, so not measured: ${line}`)
    }
  }

  return { compared, unmeasured: unmeasured.length }
}

const packageDirs = readdirSync(PACKAGES_DIR).sort()
for (const dir of packageDirs) check(dir)
const keyReport = checkDecorationKeys(packageDirs)
const docsReport = checkSeamDocumentation(packageDirs)
const peerReport = checkPeerRangesAgainstInstalled(packageDirs)

if (violations.length > 0) {
  console.error(`✗ ${violations.length} manifest violation(s):\n`)
  for (const v of violations) console.error(`  ${v}`)
  console.error('')
  process.exit(1)
}

// The three claims below were already guarded by their own counts — this file is where the
// `Never unconditional` reasoning was first written. What it lacked was the count for its OWN
// subject: with `packages/` empty, every sub-check trivially passes and all three ✓ lines print
// for a run that opened no manifest at all (B-026).
const summary =
  '✓ every package manifest is publishable (repository + directory, provenance, no escaping local paths)\n' +
  '✓ no package re-invents a theokit type, and every `theokit`/`@theokit/*` peer is used or triaged\n' +
  // Never unconditional. A summary that claims "no two packages claim the same key" after
  // resolving none of them is a green line the run did not earn — and that is exactly what the
  // first version printed while an ordinary refactor hid a real collision.
  (keyReport.unresolved > 0
    ? `⚠ ${keyReport.compared} request-decoration key(s) compared; ${keyReport.unresolved} could NOT be resolved statically and were not compared (listed above)`
    : `✓ no two packages claim the same request-decoration key (${keyReport.compared} compared)`) +
  (docsReport.registry === false
    ? `\n⚠ no seam registry found — 0 packages checked for documenting their factory`
    : `\n✓ every package with a seam names its factory in its README (${docsReport.checked} checked)`) +
  // Same discipline: a peer with nothing installed was not measured, and the line says so rather
  // than folding it into a count that reads as coverage.
  (peerReport.unmeasured > 0
    ? `\n⚠ ${peerReport.compared} peer range(s) checked against the installed version; ${peerReport.unmeasured} had nothing installed here and were NOT measured (listed above)`
    : `\n✓ every declared peer range admits the version this repository builds against (${peerReport.compared} compared)`)
console.log(summary)
process.exit(
  reportGate({ label: 'manifests', subject: 'package manifests', checked: packageDirs.length })
    ? 0
    : 1,
)
