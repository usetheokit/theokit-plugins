/**
 * Types for the shared fence scanner.
 *
 * The module is `.mjs` because `tools/` and `scripts/` are plain build scripts with no build step
 * of their own. The declarations exist so the regression suite — which is TypeScript — can import
 * the shipped implementation rather than re-describing it, and so a change to the return shape
 * fails `pnpm typecheck` instead of surfacing as `any` in a test.
 */

/** A fenced code block, with what it needs to be understood. */
export interface FenceBlock {
  /** The fence's language tag: `ts`, `tsx`, `bash`, or `''`. */
  readonly lang: string
  /** Everything after the fence marker, trimmed. */
  readonly info: string
  /** 1-based line of the opening fence. */
  readonly startLine: number
  /**
   * The nearest non-blank line above the opener — where a `doc-example` marker lives.
   *
   * Blank lines are transparent because `pnpm format` inserts one between an HTML comment and the
   * fence below it. Prose is not: a marker separated from its block by a paragraph does not attach.
   */
  readonly precedingLine: string
  /** The block's contents, newline-joined. */
  readonly body: string
  /** Set when a `doc-example` marker in the file reaches no block at all. */
  readonly orphanedMarker?: { readonly line: number; readonly text: string }
}

export interface SplitFences {
  /** True when a fence was opened and never closed — every later block is invisible. */
  readonly unclosed: boolean
  /** Lines inside fenced or four-space-indented blocks. */
  readonly code: string[]
  /** Every other line. */
  readonly prose: string[]
  readonly blocks: FenceBlock[]
}

export function splitFences(text: string): SplitFences

/** What a block declares about itself. */
export interface ExampleMarkers {
  /** Abbreviated: parsed, never type-checked. */
  readonly partial: boolean
  /** Shares scope with the preceding compilable block of the same file. */
  readonly continues: boolean
  /** Modules the block uses that the harness must stand in for. */
  readonly needs: string[]
}

export function parseExampleMarkers(line: string): {
  readonly markers: ExampleMarkers
  /** Keys nobody reads — reported so a typo cannot silently downgrade a block. */
  readonly unknown: string[]
}
