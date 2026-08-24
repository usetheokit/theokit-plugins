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

import { reportGate } from './lib/gate-summary.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

import { parseExampleMarkers, splitFences } from './lib/markdown-fences.mjs'
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
  // Named per FILE, not per specifier. Whether a package resolves depends on where the reader of
  // that document stands: `@theokit/orm` is linked in `plugin-db-drizzle` and absent in
  // `auth-magic-link`, so a report keyed by specifier alone says "not installed" about something
  // that is, and gives nobody a place to go and look.
  console.log(
    `[${LABEL}] i ${outOfScope.length} import(s) not checked — that package is not installed where the document's reader stands:`,
  )
  for (const claim of outOfScope) {
    console.log(`      ${claim.file}:${claim.line} — ${claim.specifier}`)
  }
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

// =================================================================================================
// Example-compile pass — the blocks, not just their imports.
//
// The import pass above asks whether documented NAMES resolve. It cannot see a wrong signature, a
// dropped option, or a method that moved. Three such defects were in eleven published READMEs on
// this pass's first run.
//
// ONE PROGRAM PER BLOCK, deliberately. The first version compiled a package's blocks together, and
// a review demonstrated three consequences of that single choice: one syntax error suppressed
// every semantic diagnostic in the package (tsc emits none when the program has any syntactic
// error), a `needs=` stub in one section replaced a real module's types with `any` for every other
// block, and the reported counts moved silently as a side effect. Per-block isolation costs a few
// seconds and removes all three.
//
// Compiled in-process rather than by spawning tsc, because 64 spawns is a minute of wall clock.

/** Compiler options every block probe shares. */
function blockCompilerOptions() {
  return {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    baseUrl: ROOT,
    paths: Object.fromEntries(
      [...publishedSpecifiers()].map(([specifier, decl]) => [specifier, [decl]]),
    ),
  }
}

/** Blocks worth compiling, with their declared markers and any structural complaint. */
function exampleBlocks() {
  const out = []
  const complaints = []
  for (const file of documentationFiles()) {
    const text = withoutRemovedLines(readFileSync(join(ROOT, file), 'utf8'))
    const { blocks, unclosed } = splitFences(text)
    if (unclosed) {
      // An unclosed fence makes every later block invisible to the scan. Silence there would be a
      // gate quietly checking less than it says.
      complaints.push(`${file}: an unclosed code fence — every block after it is invisible`)
    }
    for (const block of blocks) {
      if (!['ts', 'tsx', 'typescript'].includes(block.lang)) continue
      const { markers, unknown } = parseExampleMarkers(block.precedingLine)
      if (block.orphanedMarker) {
        complaints.push(
          `${file}:${block.orphanedMarker.line} — a doc-example marker that reaches no block`,
        )
      }
      out.push({ file, ...block, markers, unknown })
    }
  }
  return { blocks: out, complaints }
}

/**
 * A block's source, ready to compile.
 *
 * Relative `needs=` specifiers are REWRITTEN to a bare stub name. `declare module './x.js'` does
 * not apply to relative specifiers in TypeScript, so the first version's stubs were inert and the
 * block was skipped entirely — 14 of 64 blocks, every quickstart in the repository, silently
 * unchecked while `needs=` was documented as closing that hatch.
 */
function blockSource(block) {
  let body = block.body
  const stubs = []
  for (const [index, specifier] of block.markers.needs.entries()) {
    const stub = `__docStub${index}`
    const quoted = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    body = body.replace(new RegExp(`(['"\`])${quoted}\\1`, 'g'), `'${stub}'`)
    stubs.push(stub)
  }
  return { body, stubs }
}

function checkExampleBlocks() {
  const { blocks, complaints } = exampleBlocks()
  if (blocks.length === 0) {
    console.error(`[${LABEL}] x no example blocks found — the extraction is broken, not the docs`)
    process.exit(2)
  }

  const badMarkers = blocks.filter((b) => b.unknown.length > 0)
  if (badMarkers.length > 0 || complaints.length > 0) {
    console.error(`\n[${LABEL}] FAIL — the example markers do not describe the documents:`)
    for (const b of badMarkers) {
      console.error(`      ${b.file}:${b.startLine} — unknown marker: ${b.unknown.join(', ')}`)
    }
    for (const c of complaints) console.error(`      ${c}`)
    console.error('\n  A marker nobody reads silently downgrades the block it sits above.')
    return { failed: true }
  }

  // `continues` joins onto the preceding compilable block of the same file, carrying the offset so
  // a diagnostic is reported at the line a reader can open — the joined body's line numbers do not
  // map to the file without it.
  const units = []
  for (const b of blocks) {
    const prev = units.at(-1)
    if (b.markers.continues && prev !== undefined && prev.file === b.file && !b.markers.partial) {
      const seen = new Set(
        prev.segments
          .flatMap((s) => s.body.split('\n'))
          .map((l) => l.trim())
          .filter((l) => l !== ''),
      )
      const kept = b.body
        .split('\n')
        .filter((l) => !(/^import\b/.test(l.trim()) && seen.has(l.trim())))
        .join('\n')
      prev.segments.push({ ...b, body: kept })
      prev.markers = {
        ...prev.markers,
        needs: [...new Set([...prev.markers.needs, ...b.markers.needs])],
      }
      continue
    }
    units.push({ ...b, segments: [{ ...b }] })
  }

  const typeChecked = []
  const parseOnly = []
  const harnessGaps = []
  const failures = []

  for (const unit of units) {
    const joined = unit.segments.map((s) => s.body).join('\n')
    const { body, stubs } = blockSource({ ...unit, body: joined })

    /** Map a 1-based line in the joined body back to the file and line a reader can open. */
    const locate = (line) => {
      let remaining = line
      for (const segment of unit.segments) {
        const height = segment.body.split('\n').length
        if (remaining <= height) return { file: segment.file, line: segment.startLine + remaining }
        remaining -= height + 1
      }
      const last = unit.segments.at(-1)
      return { file: last.file, line: last.startLine }
    }

    if (unit.markers.partial) {
      // Parsed, never skipped. An elision means the block cannot type-check; it does not mean the
      // block can be anything.
      const parsed = ts.createSourceFile(
        'block.tsx',
        body,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      )
      const syntax = parsed.parseDiagnostics ?? []
      if (syntax.length > 0) {
        const { line } = parsed.getLineAndCharacterOfPosition(syntax[0].start ?? 0)
        const at = locate(line + 1)
        failures.push({
          ...at,
          kind: 'parse',
          message: ts.flattenDiagnosticMessageText(syntax[0].messageText, ' '),
        })
      } else {
        parseOnly.push(unit)
      }
      continue
    }

    // The virtual file lives INSIDE the resolution root, so node_modules lookup walks up from the
    // package the document belongs to — `resolutionRoot()` already answers "where does this
    // document's reader stand". At the filesystem root it resolved nothing, and every real module
    // reported TS2307.
    const root = resolutionRoot(unit.file)
    const blockPath = join(root, '__doc-block.tsx')
    const stubPath = join(root, '__doc-stubs.d.ts')

    // A shorthand ambient declaration: everything imported from the name is `any`. A stub that
    // exported a concrete value rejected named imports the block legitimately makes.
    const files = new Map([
      [blockPath, body],
      [stubPath, `${stubs.map((stub) => `declare module '${stub}';`).join('\n')}\n`],
    ])

    const options = blockCompilerOptions()
    const host = ts.createCompilerHost(options)
    const readFile = host.readFile.bind(host)
    const fileExists = host.fileExists.bind(host)
    host.readFile = (name) => files.get(name) ?? readFile(name)
    host.fileExists = (name) => files.has(name) || fileExists(name)

    const program = ts.createProgram(
      [blockPath, ...(stubs.length > 0 ? [stubPath] : [])],
      options,
      host,
    )
    const source = program.getSourceFile(blockPath)
    const diagnostics = [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ]

    const errs = diagnostics.map((d) => ({
      code: `TS${d.code}`,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      line: d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 : 1,
    }))

    const declared = new Set(stubs)
    const unresolvedStub = errs.filter(
      (e) => e.code === 'TS2307' && [...declared].some((d) => e.message.includes(`'${d}'`)),
    )
    if (unresolvedStub.length > 0) {
      harnessGaps.push({ ...unit, errs: unresolvedStub })
      continue
    }

    if (errs.length > 0) {
      for (const e of errs.slice(0, 3)) {
        failures.push({ ...locate(e.line), kind: 'compile', message: `${e.code}: ${e.message}` })
      }
    } else {
      typeChecked.push(unit)
    }
  }

  if (failures.length > 0) {
    console.error(`\n[${LABEL}] FAIL — ${failures.length} example diagnostic(s):`)
    for (const f of failures) console.error(`      ${f.file}:${f.line} — ${f.message}`)
    console.error('\n  A reader who copies one of these gets code that does not work.')
  }

  if (harnessGaps.length > 0) {
    console.log(
      `\n[${LABEL}] i ${harnessGaps.length} block(s) not compiled — a module they declare could not be stood in for:`,
    )
    for (const b of harnessGaps)
      console.log(`      ${b.file}:${b.startLine} — ${b.errs[0].message}`)
  }

  const counts = {
    typeChecked: typeChecked.reduce((n, u) => n + u.segments.length, 0),
    parseOnly: parseOnly.reduce((n, u) => n + u.segments.length, 0),
    notSetUp: harnessGaps.reduce((n, u) => n + u.segments.length, 0),
  }
  console.log(
    `[${LABEL}] examples — ${counts.typeChecked} type-checked, ${counts.parseOnly} parsed only (declared partial), ${counts.notSetUp} not set up`,
  )

  return { failed: failures.length > 0, checked: counts.typeChecked + counts.parseOnly }
}

const exampleResult = checkExampleBlocks()
if (exampleResult.failed) process.exit(1)

// No success line existed here at all, which is the same defect wearing the opposite face: a run
// that examined nothing exited 0 in silence, and silence reads as a pass just as reliably as a
// green line does (B-026).
process.exit(
  reportGate({ label: LABEL, subject: 'documentation examples', checked: exampleResult.checked })
    ? 0
    : 1,
)
