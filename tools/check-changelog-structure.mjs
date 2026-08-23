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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT } from './lib/published-entries.mjs'

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

const path = join(ROOT, 'CHANGELOG.md')
const problems = check(readFileSync(path, 'utf8'))

if (problems.length > 0) {
  console.error(`CHANGELOG.md — ${problems.length} structural problem(s) in [Unreleased]:\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nMerge the duplicated sections; keep every entry.')
  process.exit(1)
}

console.log('CHANGELOG.md [Unreleased]: one section per category, in canonical order.')
