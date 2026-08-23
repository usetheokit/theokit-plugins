#!/usr/bin/env node
// CHANGELOG structure gate: the `[Unreleased]` block has ONE section per category, in order.
//
// `rules/cycle-release.md § Bump-level derivation` decides major/minor/patch by reading these
// sections — `Removed` non-empty means major, a `BREAKING:` entry under `Changed` means major,
// `Added` non-empty means minor. That reading assumes "the Changed section" names exactly one
// place in the file. Nothing enforced the assumption, and the block drifted into two series of
// headings: `Added`, `Changed` and `Security` each appeared twice, with two `Changed` entries
// stranded 14 lines away from the other three (#100). An extractor that stops at the first match
// sees part of the block; one that takes the last sees a different part. Neither is wrong about
// its own match, and both are wrong about the release.
//
// It is a merge accident, not a style choice: two edits each appended a full set of category
// headings, and Markdown is happy to render repeated headings forever.
//
// WHAT THIS CANNOT SEE: whether an entry sits under the RIGHT category. A fix recorded under
// `Added` parses fine here and still derives the wrong bump. That judgement is a review concern,
// and pretending to mechanise it would only move the false confidence one file over.
//
// Released sections are deliberately NOT checked. Unbreakable Rule 6 forbids editing them, so
// reporting a defect nobody may fix would be noise on every run forever.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT as REPO_ROOT } from './lib/published-entries.mjs'

/**
 * The tree this run inspects.
 *
 * Overridable so the regression suite can point the SHIPPED code at a throwaway repository
 * instead of re-implementing the tag reading and the parsing in the test — a second
 * implementation would pass while this one broke, which is the whole failure mode being guarded
 * against elsewhere in this repository.
 */
const ROOT = process.env.CHANGELOG_ROOT ?? REPO_ROOT

/** The only categories Keep a Changelog defines, in the order they must appear. */
const CANONICAL = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']

/** The `[Unreleased]` heading and every line up to the next `## ` heading. */
function unreleasedBlock(lines) {
  const start = lines.findIndex((line) => /^## \[Unreleased\]/.test(line))
  if (start === -1) return undefined
  const rest = lines.slice(start + 1).findIndex((line) => /^## /.test(line))
  const end = rest === -1 ? lines.length : start + 1 + rest
  return { start, end }
}

/** Every `### X` heading in the block, with the 1-based file line it sits on. */
function categoryHeadings(lines, block) {
  const found = []
  for (let i = block.start; i < block.end; i += 1) {
    const match = /^###\s+(.+?)\s*$/.exec(lines[i])
    if (match !== null) found.push({ name: match[1], line: i + 1 })
  }
  return found
}

function check(text) {
  const lines = text.split('\n')
  const block = unreleasedBlock(lines)
  if (block === undefined) return ['CHANGELOG.md has no `## [Unreleased]` section']

  const headings = categoryHeadings(lines, block)
  const problems = []

  const unknown = headings.filter((h) => !CANONICAL.includes(h.name))
  for (const h of unknown) {
    problems.push(
      `line ${h.line}: "### ${h.name}" is not a Keep a Changelog category ` +
        `(expected one of: ${CANONICAL.join(', ')})`,
    )
  }

  const seen = new Map()
  for (const h of headings) {
    const prior = seen.get(h.name)
    if (prior !== undefined) {
      problems.push(
        `line ${h.line}: "### ${h.name}" is declared twice in [Unreleased] ` +
          `(first at line ${prior}) — the bump derivation reads one section per category`,
      )
      continue
    }
    seen.set(h.name, h.line)
  }

  const known = headings.filter((h) => CANONICAL.includes(h.name))
  const positions = known.map((h) => CANONICAL.indexOf(h.name))
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] < positions[i - 1]) {
      problems.push(
        `line ${known[i].line}: "### ${known[i].name}" appears after ` +
          `"### ${known[i - 1].name}" — categories must follow ${CANONICAL.join(' → ')}`,
      )
    }
  }

  return problems
}

// ---------------------------------------------------------------------------------------------
// Release-drift gate: a package tag newer than the newest dated section means a release shipped
// and the narrative did not record it.
//
// The root `v*` tag convention stopped at v0.3.0 while the CHANGELOG kept recording versioned
// releases, and five versions ended up existing only in prose. `docs/adr/0002-the-repository-releases-packages-not-itself.md` records
// the decision that came out of measuring it: this repository releases PACKAGES, not itself, so
// the root CHANGELOG carries dated sections rather than a version of its own.
//
// The convention died silently precisely because nothing checked. Tags are the only artefact a
// release produces without a human, so they are what the record is compared against.
//
// What this deliberately does NOT catch: a release recorded badly. Day granularity also means a
// release and its record on the same day always agree. Both are floors, stated rather than hidden.

/** The newest tag's date and name, or null when git cannot answer. */
function newestTag() {
  try {
    const out = execFileSync(
      'git',
      [
        'for-each-ref',
        '--sort=-creatordate',
        '--format=%(creatordate:short) %(refname:short)',
        'refs/tags',
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (!out) return null
    const [date, ...rest] = out.split('\n')[0].split(' ')
    return { date, name: rest.join(' ') }
  } catch {
    return null
  }
}

/** The newest `## YYYY-MM-DD` heading in the file. */
function newestRecord(text) {
  const dates = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1])
  return dates.length ? dates.sort().at(-1) : null
}

/** Set false when the drift comparison could not be made, so the summary cannot claim it was. */
let driftChecked = true

function checkDrift(text) {
  const tag = newestTag()
  if (tag === null) {
    driftChecked = false
    // Reported, never passed over quietly. A shallow clone or a tarball has no tags, and failing
    // there would break the gate for a reason unrelated to the CHANGELOG — but claiming a clean
    // check the run did not make is the defect this repository keeps finding in its own gates.
    console.error('  \u2139 no git tags readable — the release-drift check did not run')
    return []
  }
  const record = newestRecord(text)
  if (record === null) {
    return [
      `no dated release section (\`## YYYY-MM-DD\`) in the file, while ${tag.name} is tagged ` +
        `${tag.date} — see docs/adr/0002-the-repository-releases-packages-not-itself.md`,
    ]
  }
  if (record < tag.date) {
    return [
      `${tag.name} was tagged ${tag.date}, newer than the newest record (${record}) — a release ` +
        `shipped and the CHANGELOG does not say so. See docs/adr/0002-the-repository-releases-packages-not-itself.md`,
    ]
  }
  return []
}

const path = join(ROOT, 'CHANGELOG.md')
const text = readFileSync(path, 'utf8')
const problems = check(text)
const drifts = checkDrift(text)

// Two invariants share this exit code, so each names itself. A failure that says only
// "CHANGELOG problem" sends the reader to guess which of two unrelated things broke.
if (problems.length > 0) {
  console.error(`CHANGELOG.md — ${problems.length} structural problem(s) in [Unreleased]:\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nMerge the duplicated sections; keep every entry.')
}
if (drifts.length > 0) {
  console.error(`CHANGELOG.md — ${drifts.length} release-drift problem(s):\n`)
  for (const drift of drifts) console.error(`  ${drift}`)
  console.error('\nRecord the release under a `## YYYY-MM-DD` section naming what shipped.')
}
if (problems.length > 0 || drifts.length > 0) process.exit(1)

// Never unconditional. The first version printed "the newest release is recorded" even when no
// tags were readable and nothing had been compared — the third time this exact defect appeared in
// this repository's own gates, after the decoration-key and seam-documentation checks. A summary
// that claims a comparison the run did not make is worse than no summary: the green line is what
// a reader trusts.
console.log(
  'CHANGELOG.md [Unreleased]: one section per category, in canonical order.\n' +
    (driftChecked
      ? 'CHANGELOG.md: the newest release is recorded.'
      : 'CHANGELOG.md: release drift NOT checked — no git tags readable.'),
)
