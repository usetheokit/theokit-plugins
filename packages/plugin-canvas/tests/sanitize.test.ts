/**
 * T4.3 — defence-in-depth sanitiser tests. These run BEFORE renderers
 * touch the DOM so the strip behaviour is exercised in isolation.
 */
import { describe, expect, it } from 'vitest'

import { sanitizeHtmlSrcdoc, sanitizeSvg } from '../src/ui/renderers/sanitize.js'

describe('sanitizeSvg', () => {
  it('strips <script> tags and reports', () => {
    const { output, report } = sanitizeSvg('<svg><script>alert(1)</script><rect /></svg>')
    expect(output).not.toMatch(/<script/i)
    expect(output).toMatch(/<rect/)
    expect(report.removedScript).toBe(true)
  })

  it('strips on* handlers', () => {
    const { output, report } = sanitizeSvg(
      '<svg><rect onclick="alert(1)" onmouseenter=\'bad()\' /></svg>',
    )
    expect(output).not.toMatch(/onclick/)
    expect(output).not.toMatch(/onmouseenter/)
    expect(report.removedOnHandler).toBe(true)
  })

  it('strips javascript: URLs in href / xlink:href / src', () => {
    const { output, report } = sanitizeSvg(
      `<svg><a href="javascript:bad()"><image xlink:href='javascript:bad()'/></a></svg>`,
    )
    expect(output).not.toMatch(/javascript:/)
    expect(report.removedJsUrl).toBe(true)
  })

  it('strips <iframe>, <object>, <embed>', () => {
    const { output, report } = sanitizeSvg(
      '<svg><iframe src="evil"></iframe><object data="evil"></object><embed src="evil"/></svg>',
    )
    expect(output).not.toMatch(/<iframe/i)
    expect(output).not.toMatch(/<object/i)
    expect(output).not.toMatch(/<embed/i)
    expect(report.removedIframe).toBe(true)
    expect(report.removedObject).toBe(true)
    expect(report.removedEmbed).toBe(true)
  })

  it('strips data:text/html and data:application/javascript URLs', () => {
    const { output, report } = sanitizeSvg(
      `<svg><a href="data:text/html,<script>bad()</script>">x</a></svg>`,
    )
    expect(output).not.toMatch(/data:text\/html/)
    expect(report.removedDataUrl).toBe(true)
  })

  it('strips <foreignObject> (XSS escape hatch)', () => {
    const { output } = sanitizeSvg(
      '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>',
    )
    expect(output).not.toMatch(/<foreignObject/i)
    expect(output).not.toMatch(/<script/i)
  })

  it('strips case-mixed javascript: URIs', () => {
    const { output } = sanitizeSvg('<svg><a href="jAvAsCrIpT:alert(1)">x</a></svg>')
    expect(output).not.toMatch(/javascript:/i)
  })

  it('strips nested script inside <defs>', () => {
    const { output } = sanitizeSvg('<svg><defs><script>bad()</script></defs><rect/></svg>')
    expect(output).not.toMatch(/<script/i)
    expect(output).toMatch(/<rect/)
  })

  it('strips CSS expression() in style attributes', () => {
    const { output } = sanitizeSvg('<svg><rect style="width:expression(alert(1))"/></svg>')
    expect(output).not.toMatch(/expression\s*\(/i)
  })

  it('strips <use> with external xlink:href', () => {
    const { output } = sanitizeSvg('<svg><use xlink:href="http://evil.com/payload.svg#x"/></svg>')
    expect(output).not.toMatch(/evil\.com/)
  })

  it('strips on-event with newline evasion', () => {
    const { output } = sanitizeSvg('<svg><rect on\nmouseover="alert(1)" /></svg>')
    expect(output).not.toMatch(/alert/)
  })

  it('is a no-op for clean SVG', () => {
    const clean =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></rect></svg>'
    const { output, report } = sanitizeSvg(clean)
    expect(output).toContain('<rect')
    expect(output).toContain('<svg')
    expect(report.removedScript).toBe(false)
    expect(report.removedOnHandler).toBe(false)
    expect(report.removedJsUrl).toBe(false)
  })

  // T1.4 (#179 regex mutate corrupts valid markup + #180 lossy verdict):
  // a benign https href that merely contains the literal "javascript:" in its
  // query string is SAFE (DOMPurify keeps it — the scheme is https). The old
  // post-sanitize regex deleted the whole href (corruption, #179) AND the
  // regex-diff verdict then falsely reported removedJsUrl=true (#180).
  it('keeps a benign https href containing "javascript:" in its query and does not falsely flag removedJsUrl', () => {
    const { output, report } = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com/?ref=javascript:guide"><rect/></a></svg>',
    )
    expect(output).toContain('example.com') // #179: valid href not nuked
    expect(output).toMatch(/href=/) // the href attribute survives
    expect(report.removedJsUrl).toBe(false) // #180: accurate verdict — nothing js-URL was removed
  })
})

describe('sanitizeHtmlSrcdoc', () => {
  it('strips <meta http-equiv="refresh"> redirects', () => {
    const { output } = sanitizeHtmlSrcdoc(
      '<meta http-equiv="refresh" content="0;url=https://evil"><p>hi</p>',
    )
    expect(output).not.toMatch(/<meta[^>]*refresh/i)
    expect(output).toMatch(/<p>hi/)
  })

  it('preserves benign HTML content', () => {
    const { output } = sanitizeHtmlSrcdoc('<p>hi</p>')
    expect(output).toContain('<p>hi</p>')
  })

  // #F-arch-1/F-sec-1: verdict must come from DOMPurify removals, not a regex
  // that requires quoted http-equiv (unquoted meta-refresh bypassed it).
  it('test_unquoted_meta_refresh_srcdoc_is_flagged (#F-arch-1)', () => {
    const { output, report } = sanitizeHtmlSrcdoc('<meta http-equiv=refresh content=0><p>hi</p>')
    expect(report.removedScript).toBe(true) // dangerous removal → enforceArtifactSecurity throws
    expect(output).not.toMatch(/<meta/i)
  })

  it('test_iframe_srcdoc_is_flagged (#F-sec-1)', () => {
    const { report } = sanitizeHtmlSrcdoc('<iframe src="https://evil.test"></iframe><p>ok</p>')
    expect(report.removedScript).toBe(true)
  })

  it('test_on_handler_srcdoc_is_flagged (#F-sec-1)', () => {
    const { report } = sanitizeHtmlSrcdoc('<p onclick="evil()">x</p>')
    expect(report.removedScript).toBe(true)
  })

  it('clean HTML is not flagged (no false positive)', () => {
    const { report } = sanitizeHtmlSrcdoc('<p>hello <strong>world</strong></p>')
    expect(report.removedScript).toBe(false)
    expect(report.removedIframe).toBe(false)
  })

  it('test_script_tag_srcdoc_is_flagged (#F-sec-1)', () => {
    const { output, report } = sanitizeHtmlSrcdoc('<script>alert(1)</script><p>ok</p>')
    expect(report.removedScript).toBe(true)
    expect(output).not.toMatch(/<script/i)
  })

  it('test_javascript_url_srcdoc_is_flagged (#F-sec-1)', () => {
    const { report } = sanitizeHtmlSrcdoc('<a href="javascript:evil()">x</a>')
    expect(report.removedScript).toBe(true)
  })
})
