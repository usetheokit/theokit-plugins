/**
 * Fenced code blocks in a markdown file, and the prose outside them.
 *
 * Extracted so two gates share one implementation. `scripts/validate-manifests.mjs` needs the
 * code (does this README show its factory being called?) and `tools/check-changelog-structure.mjs`
 * needs the prose (is this `## 2026-08-23` a real heading, or an example inside a fence?).
 *
 * Both had a paired regex first, and the seam-documentation one was measured to fail two ways: an
 * opener it could not recognise — an info string, an uppercase tag, a trailing space — was not
 * skipped but DESYNCHRONISED the pairing, so prose between two blocks was captured as code; and
 * correct documentation was rejected when it used CRLF, a list-indented fence, `~~~`, or a
 * four-space block.
 *
 * A scanner tracking the open fence and its marker makes every one of those fall out rather than
 * needing a case each.
 */

/**
 * Split markdown into `{ code, prose, blocks }`.
 *
 * `code` and `prose` are arrays of lines, unchanged for the two gates that already read them.
 * `blocks` is the addition: one entry per fenced region, carrying its language, its body, the line
 * it starts on, and the line immediately above its opener — which is where a `doc-example` marker
 * lives (`docs/adr/0003`).
 *
 * Indented (four-space) blocks count as code and are removed from prose too, because a heading
 * indented four spaces is not a heading either. They are not `blocks`: an indented block carries no
 * language, so there is nothing to compile it as.
 */
export function splitFences(text) {
  const lines = text.split(/\r?\n/)
  const code = []
  const prose = []
  const blocks = []
  let fence = null

  for (const [i, line] of lines.entries()) {
    const m = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence === null) {
      // An opener may carry an info string; per CommonMark a backtick fence's info string may not
      // itself contain a backtick.
      if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
        fence = {
          marker: m[2][0],
          len: m[2].length,
          lang: m[3].trim().split(/\s+/)[0] ?? '',
          info: m[3].trim(),
          startLine: i + 1,
          // The nearest non-blank line above, reached through blank lines only.
          //
          // Strict adjacency was the first rule and it does not survive contact with the
          // formatter: `pnpm format` inserts a blank line between an HTML comment and the fence
          // below it, deterministically, and it orphaned all 41 markers on the first run after
          // they were written. Blank lines are therefore transparent; PROSE is not, so a comment
          // left behind by a moved block still fails to attach — which was the reason for
          // adjacency in the first place.
          precedingLine: precedingNonBlank(lines, i),
          body: [],
        }
        continue
      }
      if (/^ {4,}\S/.test(line)) code.push(line)
      else prose.push(line)
      continue
    }
    // A closer is the same marker, at least as long, with nothing after it.
    if (m && m[2][0] === fence.marker && m[2].length >= fence.len && m[3].trim() === '') {
      blocks.push({
        lang: fence.lang,
        info: fence.info,
        startLine: fence.startLine,
        precedingLine: fence.precedingLine,
        body: fence.body.join('\n'),
      })
      fence = null
      continue
    }
    code.push(line)
    fence.body.push(line)
  }

  return { code, prose, blocks }
}

/** The nearest non-blank line above `index`, or `''` if prose or the file start comes first. */
function precedingNonBlank(lines, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].trim() === '') continue
    return lines[i]
  }
  return ''
}

/** Keys a `doc-example` comment may carry. Anything else is reported, never ignored. */
const KNOWN_MARKERS = new Set(['partial', 'continues', 'needs', 'satisfies'])

/**
 * Read a `<!-- doc-example: … -->` comment.
 *
 * An unknown key comes back in `unknown` rather than being dropped: a typo'd marker that silently
 * downgraded a block to the default would be the exemption-by-silence this repository has closed
 * twice already, rebuilt in a third place.
 */
export function parseExampleMarkers(line) {
  const markers = { partial: false, continues: false, needs: [], satisfies: null }
  const unknown = []

  const comment = /^\s*<!--\s*doc-example:\s*(.*?)\s*-->\s*$/.exec(line ?? '')
  if (comment === null) return { markers, unknown }

  for (const token of comment[1].match(/\w+(?:="[^"]*")?/g) ?? []) {
    const [key, value] = token.split('=')
    if (!KNOWN_MARKERS.has(key)) {
      unknown.push(key)
      continue
    }
    if (key === 'needs') {
      if (value) markers.needs.push(value.replace(/^"|"$/g, ''))
      else unknown.push('needs (no value)')
    } else if (key === 'satisfies') {
      // The type the block's default export must satisfy. Without it a compiler accepts any
      // object literal, because nothing tells it what the file is FOR — measured: the wrong
      // `export default { plugins: [...] }` example type-checked cleanly, since a plain literal
      // with no expected type always does.
      if (value) markers.satisfies = value.replace(/^"|"$/g, '')
      else unknown.push('satisfies (no value)')
    } else {
      markers[key] = true
    }
  }

  return { markers, unknown }
}
