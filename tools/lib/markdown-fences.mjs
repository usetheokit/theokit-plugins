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
 * Split markdown into `{ code, prose }`, each an array of lines.
 *
 * Indented (four-space) blocks count as code and are removed from prose too, because a heading
 * indented four spaces is not a heading either.
 */
export function splitFences(text) {
  const lines = text.split(/\r?\n/)
  const code = []
  const prose = []
  let fence = null

  for (const line of lines) {
    const m = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence === null) {
      // An opener may carry an info string; per CommonMark a backtick fence's info string may not
      // itself contain a backtick.
      if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
        fence = { marker: m[2][0], len: m[2].length }
        continue
      }
      if (/^ {4,}\S/.test(line)) code.push(line)
      else prose.push(line)
      continue
    }
    // A closer is the same marker, at least as long, with nothing after it.
    if (m && m[2][0] === fence.marker && m[2].length >= fence.len && m[3].trim() === '') {
      fence = null
      continue
    }
    code.push(line)
  }

  return { code, prose }
}
