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

import { reportGate } from './lib/gate-summary.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { splitFences } from './lib/markdown-fences.mjs'
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

/** @returns {{ problems: string[], headings: number }} */
function check(text) {
  const lines = text.split('\n')
  const block = unreleasedBlock(lines)
  if (block === undefined) {
    return { problems: ['CHANGELOG.md has no `## [Unreleased]` section'], headings: 0 }
  }

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

  return { problems, headings: headings.length }
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

/**
 * Package tags only — `@scope/name@version`.
 *
 * The unfiltered `refs/tags` listing was measured to fire on anything: `nightly`,
 * `backup-before-refactor`, `v9.9.9`, a tag on an abandoned branch. Each produced the sentence
 * "a release shipped and the CHANGELOG does not say so" about something that shipped nothing, and
 * the only escapes were deleting the tag or writing a dated section for a release that never
 * happened. A gate that pressures a fabricated CHANGELOG entry is worse than no gate, and the file
 * it would corrupt is the one Unbreakable Rule 6 protects.
 */
const PACKAGE_TAG_GLOB = 'refs/tags/@*/*'

/**
 * The newest package tag's date and name, or null when git cannot answer.
 *
 * Dates are rendered in **UTC**, not in the tag's stored timezone. `%(creatordate:short)` renders
 * tagger-local, and this repository already has four tags stamped by CI at 00:04 UTC while the
 * maintainer writes headings in UTC-3 — the same instant, two calendar days. Canonicalising both
 * sides to UTC is what makes the comparison mean anything.
 *
 * `%(taggerdate)` rather than `%(creatordate)`: on a LIGHTWEIGHT tag, creatordate is the target
 * commit's date, so tagging today's release onto a January commit reported January and the gate
 * went green on an unrecorded release. A lightweight tag has no taggerdate, so it comes back empty
 * and is refused loudly below rather than being read as a meaningless date.
 */
function newestTag() {
  try {
    const out = execFileSync(
      'git',
      [
        'for-each-ref',
        '--sort=-creatordate',
        '--format=%(objecttype) %(taggerdate:format-local:%Y-%m-%d) %(refname:short)',
        PACKAGE_TAG_GLOB,
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, TZ: 'UTC' },
      },
    ).trim()
    if (!out) return null

    const [type, date, ...rest] = out.split('\n')[0].split(' ')
    const name = rest.join(' ')
    if (type !== 'tag') return { lightweight: true, name }
    if (!isRealDate(date)) return { malformed: true, date, name }
    return { date, name }
  } catch {
    return null
  }
}

/** True for a zero-padded date that is a real calendar day and not in the future. */
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // Round-trips only for a day that exists: 2026-13-45 and 2026-02-30 do not.
  return parsed.toISOString().slice(0, 10) === value
}

/**
 * The newest `## YYYY-MM-DD` heading, counting only headings OUTSIDE fenced code blocks.
 *
 * A date inside a fence is an example, not a record — and ADR 0002 models the target format inside
 * one, so it is a pattern someone would plausibly paste. Measured before this: a fenced
 * `## 2099-01-01` made the gate green over a stale record, which is the same class of defect the
 * commit immediately before this one fixed in the seam-documentation check. That scanner is now
 * shared rather than reimplemented.
 *
 * A future date is refused for the same reason: it would pass forever.
 */
function newestRecord(text) {
  const { prose } = splitFences(text)
  const today = new Date().toISOString().slice(0, 10)
  const headings = prose
    .map((line) => /^## (\S+)/.exec(line))
    .filter(Boolean)
    .map((m) => m[1])
  const dates = headings.filter((d) => isRealDate(d) && d <= today)
  const malformed = headings.filter((d) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(d) && !dates.includes(d))
  return { newest: dates.length ? dates.sort().at(-1) : null, malformed }
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
  const ADR = 'docs/adr/0002-the-repository-releases-packages-not-itself.md'

  // A tag whose date cannot be trusted is refused loudly rather than compared. Reading a
  // meaningless date and reporting a confident verdict from it is the worse failure.
  if (tag.lightweight) {
    return [
      `${tag.name} is a lightweight tag, so it carries no tagger date — a release tag must be ` +
        `annotated (\`git tag -a\`) for the record to be checkable. See ${ADR}`,
    ]
  }
  if (tag.malformed) {
    return [`${tag.name} has an unreadable tagger date (\`${tag.date}\`). See ${ADR}`]
  }

  const { newest, malformed } = newestRecord(text)
  if (malformed.length > 0) {
    // Distinguished from "no heading at all": `## 2026-8-3` is a heading somebody wrote and got
    // slightly wrong, and reporting it as absent sends them looking for the wrong thing.
    return [
      `a dated section is misformatted: ${malformed.join(', ')} — use zero-padded ` +
        `\`## YYYY-MM-DD\`. See ${ADR}`,
    ]
  }
  if (newest === null) {
    return [
      `no dated release section (\`## YYYY-MM-DD\`) outside a code block, while ${tag.name} is ` +
        `tagged ${tag.date} — see ${ADR}`,
    ]
  }
  if (newest < tag.date) {
    return [
      `${tag.name} was tagged ${tag.date} (UTC), newer than the newest record (${newest}) — a ` +
        `release shipped and the CHANGELOG does not say so. See ${ADR}`,
    ]
  }
  return []
}

const path = join(ROOT, 'CHANGELOG.md')
const text = readFileSync(path, 'utf8')
const { problems, headings } = check(text)
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
// The drift half already reported honestly. The STRUCTURE half did not: an `[Unreleased]` with
// zero category headings compares nothing and printed "one section per category, in canonical
// order" anyway — the same defect as the drift line, one claim over, in the file whose comment
// above records having already fixed it once (B-026).
console.log(
  headings === 0
    ? 'CHANGELOG.md [Unreleased]: empty — nothing pending since the last release.'
    : `CHANGELOG.md [Unreleased]: ${headings} category heading(s), one per category, in canonical order.`,
)

// The DRIFT half was already honest — it is the instance-3 fix, and it says in words whether the
// comparison ran. Keeping its own line rather than folding it into the helper's phrasing:
// `PASS — N x checked` cannot express "the newest release is recorded", and flattening it would
// have deleted a report that works. Two subjects, two claims.
console.log(
  driftChecked
    ? 'CHANGELOG.md: the newest release is recorded.'
    : 'CHANGELOG.md: release drift NOT checked — no git tags readable.',
)

// The two lines above state WHAT was verified; the helper below states whether the run earned the
// right to say it. That separation is not the "two independent console.log calls" the item warns
// about — those were two independent DECISIONS that could disagree. Here there is one decision, and
// the descriptive text has no verdict in it.
//
// The counted subject is the `[Unreleased]` BLOCK, not its category headings — and the difference
// was found by this gate firing on a legitimate change.
//
// `checked: headings` was the first shape, and it failed the commit that emptied `[Unreleased]` for
// a release. That state is normal and recurring: the block is empty after every release until the
// next change lands, so failing there would leave `main` red after each one, for a reason nobody can
// fix except by inventing an entry. That is the "gate people route around" failure.
//
// The distinction that resolves it: the block WAS found and parsed. Zero headings is its content,
// not an absence of measurement — `check()` already returns a problem when the block itself is
// missing, which is the case where nothing was examined. So the count is whether the subject was
// reached, and the heading count travels in the descriptive line above, where it informs without
// deciding.
const unreleasedFound = problems[0] !== 'CHANGELOG.md has no `## [Unreleased]` section' ? 1 : 0
process.exit(
  reportGate({
    label: 'changelog',
    subject: '`[Unreleased]` block',
    checked: unreleasedFound,
  })
    ? 0
    : 1,
)
