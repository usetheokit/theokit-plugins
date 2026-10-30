/**
 * When `seed` or `reset` has no script, the error and the command summary name only settings this
 * package reads.
 *
 * The error used to say "Set `seedScript` on drizzleDb(...) or `package.json#theokit.db.seed`".
 * Nothing in the package reads `package.json`: `resolveOptions` takes the path from
 * `drizzleDb({ seedScript })` alone, so a user who followed the second half of the message got the
 * same error back. The `seed` summary made the same claim.
 */
import { describe, expect, it } from 'vitest'

import { buildDbCommands } from '../src/cli/db.js'
import { resolveOptions } from '../src/options.js'

const commands = buildDbCommands(resolveOptions({ driver: 'sqlite', url: ':memory:' }))

function messageOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected buildArgs() to throw for an unconfigured script')
}

describe('unconfigured seed/reset script', () => {
  for (const verb of ['seed', 'reset'] as const) {
    const command = commands.find((c) => c.verb === verb)!

    it(`${verb}: the error names the drizzleDb option that supplies the script`, () => {
      expect(messageOf(() => command.buildArgs())).toContain(`\`${verb}Script\` on drizzleDb(...)`)
    })

    it(`${verb}: the error and the summary do not point at package.json`, () => {
      expect(messageOf(() => command.buildArgs())).not.toMatch(/package\.json|theokit\.db/)
      expect(command.summary).not.toMatch(/package\.json|theokit\.db/)
    })
  }
})
