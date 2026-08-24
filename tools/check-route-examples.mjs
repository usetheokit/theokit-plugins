#!/usr/bin/env node
/**
 * Every `route()` example in a published README declares a policy.
 *
 * ## The failure this exists to prevent
 *
 * `theokit@0.50.0` made `.policy()` mandatory on every route (ADR 0001): a route without one
 * fails `theokit build`, by design, so that "who may call this" is a decision somebody wrote
 * rather than a default nobody read.
 *
 * Four READMEs here — auth-github, auth-google, auth-magic-link, plugin-payments — shipped
 * copy-pasteable `route()` examples with no policy. A consumer following our own documentation
 * got a build failure, and nothing on this side reported it. The examples were correct when
 * written and became wrong when the framework moved; documentation does not fail a test suite.
 *
 * `check-doc-api-drift.mjs` did not catch it and could not: it compares examples against OUR
 * exported API, and `route()` belongs to the framework.
 *
 * ## What it checks, and what it does NOT
 *
 * It checks that a fenced block containing `route()` also contains `.policy(`. That is a
 * shape check, not a semantic one: it cannot tell a well-chosen policy from a careless
 * `'public'`, and it never will — that judgement is the whole point of ADR 0001 and belongs
 * to whoever writes the example.
 *
 * A `route()` mentioned in prose is not an example. The distinction is the same one
 * `validate-manifests.mjs` draws for decoration keys, for the same reason: prose is not code.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { reportGateAndExit } from './lib/gate-summary.mjs'

const PACKAGES_DIR = 'packages'

/** Fenced code blocks, with the line the fence opened on. */
function codeBlocks(text) {
  const blocks = []
  let open = null
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      if (open === null) open = { line: i + 1, body: [] }
      else {
        blocks.push({ line: open.line, body: open.body.join('\n') })
        open = null
      }
    } else if (open !== null) {
      open.body.push(line)
    }
  })
  return blocks
}

const violations = []
let examplesChecked = 0

for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const readme = join(PACKAGES_DIR, entry.name, 'README.md')
  let text
  try {
    text = readFileSync(readme, 'utf8')
  } catch {
    continue
  }

  for (const block of codeBlocks(text)) {
    if (!block.body.includes('route()')) continue
    examplesChecked++
    if (!block.body.includes('.policy(')) {
      violations.push(
        `${readme}:${String(block.line)} — a route() example with no .policy(). ` +
          'theokit@0.50.0+ refuses to build a route without one (ADR 0001), so a reader ' +
          'copying this gets a build failure from our own documentation.',
      )
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(`✗ ${v}`)
  console.error(
    `\n[route-examples] FAIL — ${String(violations.length)} example(s) without a policy.`,
  )
  process.exit(1)
}

// The non-vacuity floor is the shared one (B-026): a gate that examined nothing and printed a
// green line is the defect, not the check. Reimplementing it here — as the first version of this
// file did — is how the fourth gate got missed, which is what `gate-summary.offline.test.ts`
// exists to catch. It caught this one.
reportGateAndExit({
  label: 'route-examples',
  subject: 'route() example declaring a policy',
  checked: examplesChecked,
})
