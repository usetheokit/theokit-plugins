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
// dropped option, or a method that moved — and one of each shipped under #67 that a careful reading
// would have missed. The sharper demonstration is local: a gate added to this repository the same
// week required a README to call its seam factory in a code block, and the example written to
// satisfy it was `export default { plugins: [copilot({…})] }`, which is not the config surface.
// Every gate passed it.
//
// The hard part is not compiling. It is that `./session.js` (a reader's file), `@theokit/orm` (a
// real package this probe may not have installed), `yourSqliteDb` (a placeholder) and a genuinely
// wrong example are indistinguishable to a compiler — three attempts to count failures produced 2,
// 49 and 23, all wrong for that reason. So a block declares what it assumes, and the summary
// reports three numbers rather than one, because one number would hide the other two.
//
// Marker syntax and why it is an HTML comment: docs/adr/0003.

/** Blocks worth compiling, with their declared markers. */
function exampleBlocks() {
  const out = []
  for (const file of documentationFiles()) {
    const text = withoutRemovedLines(readFileSync(join(ROOT, file), 'utf8'))
    for (const block of splitFences(text).blocks) {
      if (!['ts', 'tsx', 'typescript'].includes(block.lang)) continue
      const { markers, unknown } = parseExampleMarkers(block.precedingLine)
      out.push({ file, ...block, markers, unknown })
    }
  }
  return out
}

function checkExampleBlocks() {
  const blocks = exampleBlocks()
  if (blocks.length === 0) {
    // Not a pass. Every README here opens with a code example; finding none means the extraction
    // broke, and reporting green on that is how a gate starts checking nothing while looking
    // healthy — the guard this file already applies to its import pass.
    console.error(`[${LABEL}] x no example blocks found — the extraction is broken, not the docs`)
    process.exit(2)
  }

  const badMarkers = blocks.filter((b) => b.unknown.length > 0)
  if (badMarkers.length > 0) {
    console.error(
      `\n[${LABEL}] FAIL — ${badMarkers.length} block(s) declare a marker nobody reads:`,
    )
    for (const b of badMarkers) {
      console.error(`      ${b.file}:${b.startLine} — unknown: ${b.unknown.join(', ')}`)
    }
    console.error('\n  A typo here would silently downgrade the block to the default.')
    return { failed: true }
  }

  const typeChecked = []
  const parseOnly = []
  const harnessGaps = []

  // Parse-only first: a `partial` block still has to be syntactically valid. An elision means the
  // block cannot type-check; it does not mean it can be anything.
  for (const b of blocks.filter((b) => b.markers.partial)) {
    const parsed = ts.createSourceFile(
      `${b.file}#${b.startLine}`,
      b.body,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const syntax = parsed.parseDiagnostics ?? []
    parseOnly.push({ ...b, syntax })
  }

  // `continues` blocks are compiled JOINED to the preceding compilable block of the same file.
  // A marker that only silenced the resulting TS2304 would be decorative: it would let a block
  // referencing a name that exists NOWHERE pass, which is the opposite of what the declaration
  // says. Joining makes the claim ("this shares scope with the block above") checkable.
  const compilable = []
  for (const b of blocks.filter((b) => !b.markers.partial)) {
    const prev = compilable.at(-1)
    if (b.markers.continues && prev !== undefined && prev.file === b.file) {
      // Identical import lines are dropped on join. Two blocks in a walkthrough each repeat the
      // import a reader already has in scope, and concatenating them verbatim produced
      // `TS2300: Duplicate identifier` — a diagnostic about the harness, not the documentation.
      const seen = new Set(prev.body.split('\n').map((l) => l.trim()))
      const added = b.body
        .split('\n')
        .filter((l) => !(/^import\b/.test(l.trim()) && seen.has(l.trim())))
        .join('\n')
      prev.body = `${prev.body}\n${added}`
      prev.joined = (prev.joined ?? 1) + 1
      continue
    }
    compilable.push({ ...b })
  }

  const byRoot = new Map()
  for (const b of compilable) {
    const root = resolutionRoot(b.file)
    if (!byRoot.has(root)) byRoot.set(root, [])
    byRoot.get(root).push(b)
  }

  const failures = []
  for (const [root, rootBlocks] of byRoot) {
    const probeDir = join(root, PROBE_DIRNAME)
    rmSync(probeDir, { recursive: true, force: true })
    mkdirSync(probeDir, { recursive: true })

    // A module a block DECLARES it needs is stubbed as ambient `any`, so the import resolves and
    // every other diagnostic in the block still surfaces.
    //
    // The first version skipped such a block entirely, which turned `needs=` into an escape hatch:
    // declaring one unresolvable module silenced every unrelated error beside it. Measured — the
    // wrong `export default { plugins: [...] }` example passed, because the block also imported a
    // reader's file.
    const declared = new Set(rootBlocks.flatMap((b) => b.markers.needs))
    if (declared.size > 0) {
      writeFileSync(
        join(probeDir, 'declared-modules.d.ts'),
        `${[...declared].map((m) => `declare module ${JSON.stringify(m)};`).join('\n')}\n`,
      )
    }

    const probes = rootBlocks.map((b, index) => {
      const probe = join(probeDir, `block-${index}.tsx`)
      // `satisfies=` checks the block's DEFAULT EXPORT against a declared type, by rewriting
      // `export default X` to a binding and asserting on it.
      //
      // Without this the gate cannot see the defect that motivated the whole item: the wrong
      // `export default { plugins: [copilot({…})] }` example type-checks CLEANLY, because a plain
      // object literal with no expected type always does. Nothing in the block tells a compiler
      // the file is a `theo.config.ts`. Measured: `const wrong: TheoConfig = { plugins: [] }`
      // reports TS2740 naming thirteen missing properties, so the type has teeth once it is named.
      let body = b.body
      let assertion = ''
      if (b.markers.satisfies) {
        body = body.replace(/^export default /m, 'const __docDefault = ')
        assertion =
          `\nconst __docCheck: import('theokit').${b.markers.satisfies} = __docDefault\n` +
          `void __docCheck\n`
      }
      writeFileSync(probe, `${body}\n${assertion}`)
      return { probe, block: b }
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
            jsx: 'react-jsx',
            baseUrl: ROOT,
            paths,
          },
          files: [
            ...(declared.size > 0 ? ['declared-modules.d.ts'] : []),
            ...probes.map((e) => relative(probeDir, e.probe)),
          ],
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
      if (typeof error.status !== 'number') {
        console.error(`[${LABEL}] x tsc could not be run for example blocks: ${error.message}`)
        rmSync(probeDir, { recursive: true, force: true })
        process.exit(2)
      }
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }

    const errsByProbe = new Map()
    for (const raw of output.split('\n')) {
      const m = /block-(\d+)\.tsx\((\d+),\d+\): error (TS\d+): (.+)$/.exec(raw.trim())
      if (m === null) continue
      const entry = probes[Number(m[1])]
      if (entry === undefined) continue
      if (!errsByProbe.has(entry)) errsByProbe.set(entry, [])
      errsByProbe.get(entry).push({ line: Number(m[2]), code: m[3], message: m[4] })
    }

    for (const entry of probes) {
      const errs = errsByProbe.get(entry) ?? []
      const unresolved = errs.filter((e) => e.code === 'TS2307')
      // Declared modules are stubbed above, so anything still unresolved was NOT declared — a
      // documentation failure. A declaration that somehow still fails to resolve is a harness gap.
      const blockDeclared = new Set(entry.block.markers.needs)
      const stillUnresolved = unresolved.filter((e) =>
        [...blockDeclared].some((d) => e.message.includes(`'${d}'`)),
      )
      if (stillUnresolved.length > 0) {
        harnessGaps.push({ ...entry.block, errs: stillUnresolved })
        continue
      }
      // A stub is ambient `any`, and `any` propagates: a callback whose parameter type came from a
      // stubbed module reports TS7006/TS7031. That is a consequence of the harness standing in for
      // a module, not a defect in the documentation, so it is dropped for blocks that declared one
      // — and only for those. A block with no `needs=` still fails on an untyped parameter, which
      // is how the two real defects in this pass were found.
      const meaningful =
        blockDeclared.size > 0 ? errs.filter((e) => !['TS7006', 'TS7031'].includes(e.code)) : errs
      if (meaningful.length > 0) failures.push({ ...entry.block, errs: meaningful })
      else typeChecked.push(entry.block)
    }

    rmSync(probeDir, { recursive: true, force: true })
  }

  const syntaxFailures = parseOnly.filter((b) => b.syntax.length > 0)
  if (syntaxFailures.length > 0) {
    console.error(`\n[${LABEL}] FAIL — ${syntaxFailures.length} partial block(s) do not parse:`)
    for (const b of syntaxFailures) {
      const at = b.startLine + (ts.getLineAndCharacterOfPosition ? 0 : 0)
      console.error(
        `      ${b.file}:${at} — ${ts.flattenDiagnosticMessageText(b.syntax[0].messageText, ' ')}`,
      )
    }
    console.error('\n  An elision does not excuse a syntax error.')
  }

  if (failures.length > 0) {
    console.error(`\n[${LABEL}] FAIL — ${failures.length} example block(s) do not compile:`)
    for (const b of failures) {
      // The README line, not the fence. A diagnostic pointing at the opener makes the reader
      // count lines to find what it is talking about, in a file where blocks run 30 lines.
      for (const e of b.errs.slice(0, 3)) {
        console.error(`      ${b.file}:${b.startLine + e.line} — ${e.code}: ${e.message}`)
      }
    }
    console.error('\n  A reader who copies one of these gets code that does not compile.')
  }

  if (harnessGaps.length > 0) {
    // Reported, and NOT a documentation failure. Conflating the two is what made three separate
    // measurements of this produce three different wrong numbers.
    console.log(
      `\n[${LABEL}] i ${harnessGaps.length} block(s) not compiled — a module they declare is not installed where the reader stands:`,
    )
    for (const b of harnessGaps)
      console.log(`      ${b.file}:${b.startLine} — ${b.errs[0].message}`)
  }

  // Three numbers, never one. One would hide the other two, and "how much did you actually check"
  // is the question a gate must not make its reader compute.
  console.log(
    `[${LABEL}] examples — ${typeChecked.reduce((n, b) => n + (b.joined ?? 1), 0)} type-checked, ${parseOnly.length} parsed only (declared partial), ${harnessGaps.reduce((n, b) => n + (b.joined ?? 1), 0)} not set up`,
  )

  return { failed: failures.length > 0 || syntaxFailures.length > 0 }
}

const exampleResult = checkExampleBlocks()
if (exampleResult.failed) process.exit(1)
