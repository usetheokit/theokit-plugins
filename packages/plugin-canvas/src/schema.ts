/**
 * Canonical `Artifact` protocol for @theokit/plugin-canvas.
 *
 * Discriminated union on `kind`. Each variant carries the same envelope
 * (id, sessionId?, title, version, createdAt) plus a kind-specific
 * payload. The envelope is captured by `artifactEnvelopeSchema` so each
 * variant `.extend()`s the same base — there is one shape for storage,
 * one shape for the wire, one shape for the UI prop.
 *
 * Security boundaries baked into the schema (NOT validated downstream
 * by accident):
 *
 *   - `svg` content max 256 KB. A malicious agent can still smuggle
 *     <script> tags into the SVG; the UI renderer sanitises at render
 *     time. Both gates fire (defence in depth — ADR-D2 of the plan).
 *
 *   - `html` srcdoc max 256 KB. `sandbox` is a closed enum so the
 *     consumer cannot escalate by passing arbitrary attributes; if a
 *     deployment needs more isolation, downgrade the value but never
 *     upgrade past `'forms'`.
 *
 *   - `image.source = "url"` requires `https://` (rejects `http://`,
 *     `data:`, `javascript:`, `blob:`). Data URLs go through the
 *     `source = "data"` variant so they parse the MIME prefix.
 *
 *   - `image.source = "data"` accepts `data:image/(png|jpeg|webp|gif|svg+xml);base64,...`
 *     with a 5 MB cap on the base64 length (≈3.75 MB decoded).
 *
 *   - `whiteboard-scene` accepts a free-form JSON object — the
 *     `<Whiteboard>` primitive from `@theokit/ui/whiteboard` runs its
 *     own Zod gate on top (clamps + finite checks).
 *
 *   - `slide-deck` accepts markdown (string) or a pre-parsed array of
 *     slides; SlideDeck primitive sanitises hast itself.
 *
 *   - `mermaid` accepts the DSL source as a string. Mermaid runtime
 *     runs with `securityLevel: 'strict'`.
 *
 *   - `code` and `markdown` content max 1 MB each (generous; avoids
 *     OOM from a runaway agent).
 *
 * These caps are *boundary defaults* — apps can lower them via the
 * `validateArtifact(opts)` overload.
 */

import { z } from 'zod'

import { CanvasArtifactSecurityError, CanvasArtifactValidationError } from './errors.js'
import { sanitizeHtmlSrcdoc, sanitizeSvg } from './ui/renderers/sanitize.js'

// ───── Envelope ─────

const isoDateOrEpoch = z.union([z.string().datetime(), z.number().int().nonnegative()])

export const artifactEnvelopeSchema = z.object({
  id: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(200),
  version: z.number().int().positive().default(1),
  createdAt: isoDateOrEpoch.default(() => new Date().toISOString()),
})

/**
 * The fields every artifact carries regardless of kind: identity, title, version, creation time.
 *
 * `id` plus `version` is the real key — artifacts are versioned rather than overwritten, so an agent
 * revising its own output does not destroy what the user was looking at.
 */
export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>

// ───── Per-kind payload schemas ─────

const MAX_CODE_BYTES = 1_048_576 // 1 MB
const MAX_MARKDOWN_BYTES = 1_048_576
const MAX_SVG_BYTES = 262_144 // 256 KB
const MAX_HTML_BYTES = 262_144
const MAX_MERMAID_BYTES = 65_536 // 64 KB — Mermaid dies on huge sources
const MAX_DATA_URL_BYTES = 5_242_880 // 5 MB base64

// Web Standard byte-length: works in browsers, Node, Bun, Deno, edge
// runtimes. `Buffer` is Node-only and crashes in the browser bundle.
const TEXT_ENCODER = /* @__PURE__ */ new TextEncoder()
const byteLength = (s: string): number => TEXT_ENCODER.encode(s).length

const sized = (max: number, fieldName: string) =>
  z.string().refine((s) => byteLength(s) <= max, {
    message: `${fieldName} exceeds the ${Math.floor(max / 1024)} KB cap.`,
  })

const markdownArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('markdown'),
  content: sized(MAX_MARKDOWN_BYTES, 'markdown content'),
})

const codeArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('code'),
  language: z.string().min(1).max(32),
  content: sized(MAX_CODE_BYTES, 'code content'),
  terminal: z.boolean().optional(),
})

const diffArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('diff'),
  path: z.string().min(1).max(1024),
  stats: z
    .object({
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
    })
    .optional(),
  hunks: z.array(
    z.object({
      id: z.string(),
      header: z.string().optional(),
      collapsed: z.boolean().optional(),
      lines: z.array(
        z.object({
          kind: z.enum(['added', 'removed', 'unchanged', 'meta']),
          oldNumber: z.number().int().nonnegative().optional(),
          newNumber: z.number().int().nonnegative().optional(),
          content: z.string(),
        }),
      ),
    }),
  ),
})

const svgArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('svg'),
  content: sized(MAX_SVG_BYTES, 'svg content').refine((s) => /^\s*<svg[\s>]/i.test(s), {
    message: 'svg content must begin with a <svg> element.',
  }),
})

const whiteboardSceneArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('whiteboard-scene'),
  scene: z.record(z.string(), z.unknown()),
})

const slideDeckArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('slide-deck'),
  source: z.union([
    sized(MAX_MARKDOWN_BYTES, 'slide-deck markdown'),
    z.array(z.record(z.string(), z.unknown())).max(200),
  ]),
})

const mermaidArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('mermaid'),
  content: sized(MAX_MERMAID_BYTES, 'mermaid source'),
})

const HTML_SANDBOX_MODES = ['minimal', 'scripts', 'forms'] as const
/**
 * How much an HTML artifact's iframe is allowed to do.
 *
 * `'minimal'` is the safe default. `'scripts'` and `'forms'` each widen the sandbox, and widening it
 * is a decision about untrusted content an agent produced — the renderer refuses combinations that
 * would let the frame escape, so an unexpected mode is rejected rather than downgraded.
 */
export type HtmlSandboxMode = (typeof HTML_SANDBOX_MODES)[number]

const htmlArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('html'),
  srcdoc: sized(MAX_HTML_BYTES, 'html srcdoc'),
  sandbox: z.enum(HTML_SANDBOX_MODES).default('minimal'),
})

const imageDataSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('image'),
  source: z.literal('data'),
  alt: z.string().min(1).max(500),
  dataUrl: z
    .string()
    .refine((s) => /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(s), {
      message: 'dataUrl must be data:image/(png|jpeg|webp|gif|svg+xml);base64,...',
    })
    .refine((s) => s.length <= MAX_DATA_URL_BYTES, {
      message: `image data URL exceeds the ${Math.floor(MAX_DATA_URL_BYTES / 1024 / 1024)} MB cap.`,
    }),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

const imageUrlSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('image'),
  source: z.literal('url'),
  alt: z.string().min(1).max(500),
  url: z.string().refine((s) => s.startsWith('https://'), {
    message: 'image URL must use https:// (http, data, javascript, blob are rejected).',
  }),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

// ───── Union ─────
// Outer schema uses `z.union` (not `z.discriminatedUnion`) so the image
// variant can carry a NESTED discriminator on `source` without
// colliding with the outer `kind` literal. The cost of the looser
// dispatch is a `safeParse` fan-out across 10 variants, which is
// negligible — agent emits at most a handful per turn.

/**
 * The artifact contract: a discriminated union over every kind this plugin renders.
 *
 * A union rather than one open shape, because each kind carries different fields and different size
 * limits — validating `content` as "some string" would let a 10 MB whiteboard scene through the same
 * gate as a one-line diff. Parsing an unknown value against this is what makes agent output safe to
 * store and render.
 */
export const artifactSchema = z.union([
  markdownArtifactSchema,
  codeArtifactSchema,
  diffArtifactSchema,
  svgArtifactSchema,
  whiteboardSceneArtifactSchema,
  slideDeckArtifactSchema,
  mermaidArtifactSchema,
  htmlArtifactSchema,
  imageDataSchema,
  imageUrlSchema,
])

/** One validated artifact — the inferred type of {@link artifactSchema}, never widened by hand. */
export type Artifact = z.infer<typeof artifactSchema>
/** The discriminant of {@link Artifact}: which renderer a given artifact needs. */
export type ArtifactKind = Artifact['kind']

/**
 * Every {@link ArtifactKind} as a runtime value, for building menus and validating input.
 *
 * Typed as `readonly ArtifactKind[]`, so a kind added to the schema and forgotten here fails to
 * compile instead of silently disappearing from whatever iterates it.
 */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'markdown',
  'code',
  'diff',
  'svg',
  'whiteboard-scene',
  'slide-deck',
  'mermaid',
  'html',
  'image',
] as const

// ───── Validation helpers ─────

/** Options for {@link validateArtifact}: whether a rejection throws or is returned as a result. */
export interface ValidateOptions {
  /** When `true`, throw a `CanvasArtifactValidationError`. */
  throwOnError?: boolean
}

/**
 * Parse an unknown value as an {@link Artifact}.
 *
 * Returns a result by default rather than throwing, because the common caller is handling
 * agent-produced content where invalid is an expected outcome, not an exceptional one. Pass
 * `throwOnError` at a boundary that should fail loudly instead.
 */
export function validateArtifact(
  input: unknown,
  opts: ValidateOptions = {},
): { ok: true; artifact: Artifact } | { ok: false; error: CanvasArtifactValidationError } {
  const parsed = artifactSchema.safeParse(input)
  if (parsed.success) return { ok: true, artifact: parsed.data }
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }))
  const error = new CanvasArtifactValidationError(
    `Artifact rejected by schema: ${issues
      .slice(0, 3)
      .map((i) => `${i.path}: ${i.message}`)
      .join('; ')}`,
    issues,
    { cause: parsed.error },
  )
  if (opts.throwOnError === true) throw error
  return { ok: false, error }
}

/**
 * Type guard over {@link artifactSchema}.
 *
 * Discards the reason a value failed. When a caller needs to report what was wrong, use
 * {@link validateArtifact}, which keeps the issues.
 */
export function isArtifact(input: unknown): input is Artifact {
  return artifactSchema.safeParse(input).success
}

// ───── Defence-in-depth checks that Zod does not express ─────

/**
 * Secondary pass over an artifact that catches semantic issues Zod
 * cannot express directly:
 *
 *   - SVG bodies that smuggle `<script>` or `javascript:` URLs
 *   - HTML srcdoc that attempts to open a top-level navigation
 *
 * Renderers also sanitise at render time; this is the boundary gate so
 * the wire never carries a known-bad payload.
 */
export function enforceArtifactSecurity(artifact: Artifact): void {
  if (artifact.kind === 'svg') {
    const { report } = sanitizeSvg(artifact.content)
    if (report.removedScript) {
      throw new CanvasArtifactSecurityError(
        'SVG contains <script>. Strip it client-side before publishing.',
        'svg-script-tag',
      )
    }
    if (report.removedJsUrl) {
      throw new CanvasArtifactSecurityError(
        'SVG contains a javascript: xlink:href. Strip it client-side before publishing.',
        'svg-javascript-href',
      )
    }
  }
  if (artifact.kind === 'html') {
    const { report } = sanitizeHtmlSrcdoc(artifact.srcdoc)
    // sanitizeHtmlSrcdoc sets removedScript=true when a meta-refresh is stripped
    // (meta-refresh is a navigation attack, categorized under the script removal signal)
    if (report.removedScript) {
      throw new CanvasArtifactSecurityError(
        'HTML srcdoc contains a meta refresh. Strip it before publishing.',
        'html-meta-refresh',
      )
    }
  }
  // T1.2 (#178) — extend the gate to the remaining script-capable kinds.
  if (artifact.kind === 'image' && artifact.source === 'data') {
    enforceImageDataSecurity(artifact.dataUrl)
  }
  if (artifact.kind === 'mermaid' && hasMermaidScriptVector(artifact.content)) {
    throw new CanvasArtifactSecurityError(
      'Mermaid source contains a <script>, javascript: URL, or click-callback. Strip it before publishing.',
      'mermaid-script-vector',
    )
  }
  if (
    artifact.kind === 'slide-deck' &&
    typeof artifact.source === 'string' &&
    /<script\b/i.test(artifact.source)
  ) {
    // String markdown is scanned for the obvious <script> vector. A pre-parsed
    // array source is sanitised downstream by the SlideDeck primitive's own
    // hast sanitiser (see file docstring) — explicit allow, no scan here.
    throw new CanvasArtifactSecurityError(
      'Slide-deck markdown contains <script>. Strip it before publishing.',
      'slide-deck-script',
    )
  }
}

/**
 * Decode an `image` `source:'data'` SVG data URL and run it through the SVG
 * sanitiser. Only `image/svg+xml` is inspected (raster MIME types cannot carry
 * executable markup). Malformed base64 is rejected as a typed security error so
 * the boundary never leaks a raw `atob` DOMException to the caller (EC-6).
 */
function enforceImageDataSecurity(dataUrl: string): void {
  if (!/^data:image\/svg\+xml;base64,/i.test(dataUrl)) return
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  let decoded: string
  try {
    // atob yields a Latin-1 byte string; that is fine for ASCII script-vector
    // detection (`<script>`/`javascript:` survive byte decode). Do NOT swap to
    // TextDecoder — the sanitiser only needs the markup, not the encoding.
    decoded = atob(base64)
  } catch {
    throw new CanvasArtifactSecurityError(
      'image data URL is not valid base64.',
      'image-data-malformed',
    )
  }
  const { report } = sanitizeSvg(decoded)
  if (report.removedScript) {
    throw new CanvasArtifactSecurityError(
      'SVG image data URL contains <script>. Strip it before publishing.',
      'image-svg-script',
    )
  }
  if (report.removedJsUrl) {
    throw new CanvasArtifactSecurityError(
      'SVG image data URL contains a javascript: href. Strip it before publishing.',
      'image-svg-javascript-href',
    )
  }
}

/**
 * Heuristic scan of mermaid DSL source for script-injection vectors. The
 * boundary runs server-side and sync, so it cannot render mermaid; it scans
 * the raw source for `<script>`, `javascript:` URLs, and the `click … call|href`
 * callback form. `securityLevel:'strict'` is the render-time companion (T1.3).
 *
 * INTENTIONALLY CONSERVATIVE: the `<script>` / `javascript:` substring checks
 * also reject a benign node *label* that merely contains those literals. A
 * security boundary erring toward rejection is acceptable here — legitimate
 * diagrams rarely embed these tokens, and the publisher can rephrase. The
 * functional XSS defense is the render-time sanitize (T1.3) + strict mode;
 * this scan is belt-and-suspenders.
 */
function hasMermaidScriptVector(source: string): boolean {
  return (
    /<script\b/i.test(source) ||
    /javascript:/i.test(source) ||
    /^\s*click\s+\S+\s+(?:call|href)\b/im.test(source)
  )
}
