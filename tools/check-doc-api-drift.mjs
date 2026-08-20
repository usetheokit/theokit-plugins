#!/usr/bin/env node
// Documentation-vs-API drift gate.
//
// Every README in this repository opens by telling a consumer to write an import. Nothing checked
// that the names in those imports exist. A published example that does not compile is a first
// impression, and it is the cheapest way there is to lose a reader who was about to try the thing.
//
// THE ORACLE IS THE COMPILER, NOT A REGEX OVER `.d.ts` TEXT. Matching names is exactly what fails
// here: an export can be written in a form a hand-rolled parser does not read, and the parser then
// reports a real export as missing. Each `import { ... } from "..."` found in a tracked markdown
// file becomes a generated probe; `tsc --noEmit` says which names do not resolve, and each
// diagnostic is mapped back to the artifact and line that claimed it.
//
// WORKSPACE SPECIFIERS ARE RESOLVED BY AN EXPLICIT `paths` MAP, NOT BY WHERE THE PROBE STANDS. In
// this repository no package self-links and `integration/` declares only seven of the eleven, so
// standing the probe in the document's own package would leave most documented names unresolvable —
// the gate would report a gap on nearly every README while checking almost nothing. The map is
// built from each package's own `exports` field and points at the emitted declarations, which is
// the same file a consumer installs.
//
// EXTERNAL SPECIFIERS ARE CHECKED WHERE THE READER STANDS. `theokit`, `@theokit/sdk`, `zod` and the
// rest are versioned dependencies, and the workspace holds several versions of some of them at
// once, so a probe is compiled from inside the package that owns the document — the root whose
// `node_modules` has the version that package declares — falling back to `integration/`. An
// external the workspace does not install at all is out of scope and counted, not failed: this
// repository does not choose whether someone installs `@theokit/orm`.
//
// "COULD NOT CHECK" IS NOT "IS WRONG". A module that fails to RESOLVE (TS2307) says the probe stood
// in the wrong place; a name missing from a module that did resolve (TS2305/TS2724) says the
// documentation is wrong. They are reported apart, and an unresolvable WORKSPACE module fails the
// run as a broken gate (exit 2) rather than as a documentation defect.
//
// WHAT A DOCUMENT INSTRUCTS vs WHAT IT RECORDS. A `CHANGELOG.md` entry that says a symbol was
// removed names that symbol on purpose, and so does the `-` side of a ```diff migration block: both
// describe a past state a reader is being moved AWAY from. Checking them would report the record as
// a defect and pressure someone into rewriting history to make a gate green. Only the instruction
// half is checked — which is where the value is: the `+` side of the payments migration block in
// this repository tells the reader to move `payments` to a subpath that does not export it.
//
// A DEFERRED FINDING IS STILL PRINTED. `doc-api-drift-allowlist.txt` lets a name that cannot be
// fixed in this pass carry a mandatory sunset instead of holding the run red forever. That is not
// the same as hiding it: every deferred name is listed with its date on every run, an entry whose
// date has passed re-fires at full severity, and a malformed entry aborts the run. The reason the
// mechanism exists at all is that a gate which is red BY DESIGN stops being read, and then misses
// the next real drift — the whole reason it was built.
//
// This reads the PUBLISHED declarations, so `pnpm build` must have run first.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { publishedPackages, publishedSpecifiers, ROOT } from './lib/published-entries.mjs'

const ALLOWLIST = join(ROOT, 'tools', 'doc-api-drift-allowlist.txt')

const LABEL = 'doc-api-drift'
const PROBE_DIRNAME = '.doc-probes'
const TODAY = new Date().toISOString().slice(0, 10)

/**
 * @returns {{active: Map<string, {sunset: string, rationale: string}>, expired: Array}} deferrals
 * keyed `specifier\u0000name`. A malformed line throws: an exemption nobody can parse must not read
 * as an exemption nobody needed.
 */
function deferrals() {
  const active = new Map()
  const expired = []
  if (!existsSync(ALLOWLIST)) return { active, expired }
  const lines = readFileSync(ALLOWLIST, 'utf8').split('\n')
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const parts = line.split('|').map((part) => part.trim())
    if (parts.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
      console.error(`[${LABEL}] x malformed allowlist entry at line ${index + 1}: ${line}`)
      console.error('  Expected: SPECIFIER | NAME | SUNSET (YYYY-MM-DD) | RATIONALE')
      process.exit(2)
    }
    const [specifier, name, sunset, ...rest] = parts
    const entry = { specifier, name, sunset, rationale: rest.join(' | ') }
    if (sunset < TODAY) expired.push(entry)
    else active.set(`${specifier}\u0000${name}`, entry)
  }
  return { active, expired }
}

/** `import { A, type B } from "pkg"` — the shape every README example uses. */
const IMPORT = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"'\n]+)["']/g

/** Tracked markdown that INSTRUCTS a reader. Changesets and changelogs record releases instead. */
function documentationFiles() {
  return execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(
      (path) =>
        path.length > 0 && !path.startsWith('.changeset/') && !path.endsWith('CHANGELOG.md'),
    )
}

/** Blank the removed side of every ```diff block: it names the API the reader is moving away from. */
function withoutRemovedLines(text) {
  return text.replace(/```diff\r?\n[\s\S]*?```/g, (block) =>
    block
      .split('\n')
      .map((line) => (/^-(?!--)/.test(line) ? '' : line))
      .join('\n'),
  )
}

/** Every documented import of a package, with the artifact and line that claims it. */
function documentedImports() {
  const claims = []
  for (const file of documentationFiles()) {
    const text = withoutRemovedLines(readFileSync(join(ROOT, file), 'utf8'))
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[2]
      // Relative paths belong to the reader's own tree; `node:` builtins belong to the runtime.
      // Neither is a published API this repository or its dependencies can drift against.
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue
      if (specifier.startsWith('node:')) continue
      const names = match[1]
        .split(',')
        .map((name) => name.trim().replace(/^type\s+/, ''))
        .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
      if (names.length === 0) continue
      claims.push({
        file,
        line: text.slice(0, match.index).split('\n').length,
        specifier,
        names,
      })
    }
  }
  return claims
}

/** Where a reader of `file` stands: its own package first, then the member that has the most links. */
function resolutionRoot(file) {
  const owner = /^(packages\/[^/]+)\//.exec(file)
  if (owner !== null && existsSync(join(ROOT, owner[1], 'node_modules'))) {
    return join(ROOT, owner[1])
  }
  return join(ROOT, 'integration')
}

/** Whether an external specifier is installed at `root` — walking up as node resolution would. */
function externalResolves(root, specifier) {
  const pkg = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
  for (let dir = root; dir.startsWith(ROOT); dir = join(dir, '..')) {
    if (existsSync(join(dir, 'node_modules', pkg, 'package.json'))) return true
    if (dir === ROOT) break
  }
  return false
}

const unbuilt = publishedPackages().filter((pkg) => !pkg.built)
if (unbuilt.length > 0) {
  console.error(
    `[${LABEL}] x ${unbuilt.map((pkg) => pkg.name).join(', ')} have no dist/ — run pnpm build`,
  )
  console.error(
    '  Refusing to report: the names would resolve against declarations that do not exist.',
  )
  process.exit(2)
}

const workspace = publishedSpecifiers()
const claims = documentedImports()
if (claims.length === 0) {
  // Not a pass. Every README here opens with an import example; finding none means the extraction
  // broke, and reporting green on that is how a gate starts checking nothing while looking healthy.
  console.error(`[${LABEL}] x no documented imports found — the extraction is broken, not the docs`)
  process.exit(2)
}

// `paths` needs entries relative to the probe's tsconfig, which sits at the repository root.
const paths = Object.fromEntries(
  [...workspace].map(([specifier, decl]) => [specifier, [`./${relative(ROOT, decl)}`]]),
)

const outOfScope = []
const byRoot = new Map()
for (const claim of claims) {
  const isWorkspace = workspace.has(claim.specifier)
  const root = resolutionRoot(claim.file)
  if (!isWorkspace && !externalResolves(root, claim.specifier)) {
    outOfScope.push(claim)
    continue
  }
  if (!byRoot.has(root)) byRoot.set(root, [])
  byRoot.get(root).push({ ...claim, isWorkspace })
}

const drifted = []
const notChecked = []

for (const [root, rootClaims] of byRoot) {
  const probeDir = join(root, PROBE_DIRNAME)
  rmSync(probeDir, { recursive: true, force: true })
  mkdirSync(probeDir, { recursive: true })

  // One probe per claim, so a diagnostic's file name identifies the artifact that made the claim.
  const probes = rootClaims.map((claim, index) => {
    const probe = join(probeDir, `probe-${index}.ts`)
    writeFileSync(
      probe,
      `import type { ${claim.names.join(', ')} } from ${JSON.stringify(claim.specifier)};\n`,
    )
    return { probe, claim }
  })

  writeFileSync(
    join(probeDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          target: 'es2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          baseUrl: ROOT,
          paths,
        },
        files: probes.map((entry) => relative(probeDir, entry.probe)),
      },
      null,
      2,
    )}\n`,
  )

  let output = ''
  try {
    execFileSync('npx', ['tsc', '-p', probeDir], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    // A failed invocation is not a clean compile.
    if (typeof error.status !== 'number') {
      console.error(`[${LABEL}] x tsc could not be run: ${error.message}`)
      console.error('  Refusing to report: a gate that cannot invoke its tool has checked nothing.')
      rmSync(probeDir, { recursive: true, force: true })
      process.exit(2)
    }
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }

  for (const raw of output.split('\n')) {
    const match = /probe-(\d+)\.ts\(\d+,\d+\): error (TS\d+): (.+)$/.exec(raw.trim())
    if (match === null) continue
    const entry = probes[Number(match[1])]
    if (entry === undefined) continue
    if (match[2] === 'TS2307') {
      notChecked.push(entry.claim) // the module did not resolve — the probe stood wrong, not the doc
      continue
    }
    const name = /has no exported member(?: named)? '([^']+)'/.exec(match[3])?.[1]
    drifted.push({ ...entry.claim, name: name ?? entry.claim.names.join(', ') })
  }

  rmSync(probeDir, { recursive: true, force: true })
}

const checked = claims.filter((claim) => !outOfScope.includes(claim) && !notChecked.includes(claim))
const checkedNames = checked.reduce((total, claim) => total + claim.names.length, 0)

if (outOfScope.length > 0) {
  const specifiers = [...new Set(outOfScope.map((claim) => claim.specifier))].sort()
  console.log(
    `[${LABEL}] i ${outOfScope.length} import(s) of ${specifiers.length} package(s) this workspace does not install — out of scope:`,
  )
  for (const specifier of specifiers) console.log(`      ${specifier}`)
}

if (notChecked.length > 0) {
  const workspaceGaps = notChecked.filter((claim) => workspace.has(claim.specifier))
  console.error(
    `\n[${LABEL}] x ${notChecked.length} import(s) could not be checked — module unresolvable:`,
  )
  for (const claim of notChecked) {
    console.error(`      ${claim.file}:${claim.line} — ${claim.specifier} did not resolve`)
  }
  console.error(
    '  This is a gap in the gate, not a defect in the documentation. Link the package or teach',
  )
  console.error('  the gate where a reader of that document stands.')
  if (workspaceGaps.length === 0) {
    console.error(
      '  None of these is a workspace package; the published surface was still checked.',
    )
  }
}

const { active: deferred, expired } = deferrals()
const stillOpen = drifted.filter((item) => !deferred.has(`${item.specifier}\u0000${item.name}`))
const carried = drifted.filter((item) => deferred.has(`${item.specifier}\u0000${item.name}`))

if (expired.length > 0) {
  console.error(`\n[${LABEL}] x ${expired.length} allowlist entr(ies) expired — re-firing:`)
  for (const entry of expired) {
    console.error(`      ${entry.specifier} '${entry.name}' — sunset ${entry.sunset} has passed`)
  }
}

if (carried.length > 0) {
  const seen = new Map()
  for (const item of carried) {
    const key = `${item.specifier}\u0000${item.name}`
    if (!seen.has(key)) seen.set(key, { ...item, count: 0 })
    seen.get(key).count += 1
  }
  console.log(`\n[${LABEL}] i ${seen.size} documented name(s) deferred with a sunset:`)
  for (const item of seen.values()) {
    const sunset = deferred.get(`${item.specifier}\u0000${item.name}`).sunset
    console.log(
      `      ${item.specifier} has no '${item.name}' — ${item.count} occurrence(s), sunset ${sunset}`,
    )
  }
  console.log('  Deferred is not fixed. See tools/doc-api-drift-allowlist.txt for why and by when.')
}

const drifted_ = stillOpen
if (drifted_.length > 0) {
  console.error(`\n[${LABEL}] FAIL — ${drifted_.length} documented name(s) do not exist:`)
  for (const item of drifted_) {
    console.error(`      ${item.file}:${item.line} — ${item.specifier} has no '${item.name}'`)
  }
  console.error('\n  A reader who copies one of these gets code that does not compile.')
}

if (drifted_.length > 0 || expired.length > 0) process.exit(1)
if (notChecked.length > 0) process.exit(2)

const resolved = checkedNames - carried.length
console.log(
  `[${LABEL}] PASS — ${resolved} of ${checkedNames} documented name(s) across ${
    checked.length
  } import(s) in ${new Set(checked.map((claim) => claim.file)).size} file(s) resolve${
    carried.length > 0 ? `; the other ${carried.length} are deferred above, not resolved.` : '.'
  }`,
)
