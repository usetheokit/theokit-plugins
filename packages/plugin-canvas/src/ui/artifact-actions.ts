/**
 * Pure helpers for the CanvasPanel toolbar actions.
 *
 * Factored out so the panel stays a thin orchestrator and the
 * per-kind serialisation can be unit-tested without React/jsdom in
 * the loop.
 */
import type { Artifact, ArtifactKind } from '../schema.js'

const EXT_BY_LANG: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  py: 'py',
  python: 'py',
  rb: 'rb',
  ruby: 'rb',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cs: 'cs',
  csharp: 'cs',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  shell: 'sh',
  sql: 'sql',
  yaml: 'yml',
  yml: 'yml',
  json: 'json',
  toml: 'toml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  markdown: 'md',
  md: 'md',
  text: 'txt',
  plaintext: 'txt',
}

const EXT_BY_KIND: Record<ArtifactKind, string> = {
  markdown: 'md',
  code: 'txt', // overridden per-language below
  diff: 'diff',
  svg: 'svg',
  'whiteboard-scene': 'json',
  'slide-deck': 'md',
  mermaid: 'mmd',
  html: 'html',
  image: 'bin', // overridden by data-url MIME
}

/**
 * Slugify a title for use as a filename. Drops anything not in
 * `[A-Za-z0-9-_]`, collapses runs, and caps at 64 chars so the file
 * system is never surprised.
 */
export function slugifyFilename(title: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'artifact'
}

/**
 * Pick the file extension for a download based on the artifact kind +
 * any inner hint (code language, image data URL MIME). Returns a
 * lowercase extension WITHOUT the leading dot.
 */
export function pickExtension(artifact: Artifact): string {
  if (artifact.kind === 'code') {
    const lang = artifact.language.toLowerCase()
    return EXT_BY_LANG[lang] ?? 'txt'
  }
  if (artifact.kind === 'image' && artifact.source === 'data') {
    const match = artifact.dataUrl.match(/^data:image\/([a-z+]+);base64,/i)
    if (match !== null) {
      const mime = match[1] ?? 'bin'
      // svg+xml → svg
      return mime.replace(/\+xml$/i, '')
    }
  }
  return EXT_BY_KIND[artifact.kind]
}

/**
 * Serialise an artifact to a copyable string. Code keeps the raw
 * source; markdown stays markdown; svg/html/mermaid stay textual;
 * whiteboard-scene and slide-deck get JSON-stringified; image returns
 * the data URL OR the https URL depending on the variant; diff is
 * rendered to the canonical unified-diff text format.
 */
export function serializeArtifactForCopy(artifact: Artifact): string {
  switch (artifact.kind) {
    case 'markdown':
    case 'code':
    case 'svg':
    case 'mermaid':
      return artifact.content
    case 'html':
      return artifact.srcdoc
    case 'whiteboard-scene':
      return JSON.stringify(artifact.scene, null, 2)
    case 'slide-deck':
      return slideDeckSource(artifact)
    case 'image':
      return artifact.source === 'data' ? artifact.dataUrl : artifact.url
    case 'diff':
      return formatDiffArtifact(artifact)
    default: {
      const exhaustive: never = artifact
      throw new Error(`Unhandled artifact kind: ${(exhaustive as { kind: string }).kind}`)
    }
  }
}

/** #187: slide-deck source — raw string, or pretty-printed JSON when structured. */
function slideDeckSource(artifact: Extract<Artifact, { kind: 'slide-deck' }>): string {
  return typeof artifact.source === 'string'
    ? artifact.source
    : JSON.stringify(artifact.source, null, 2)
}

/** #187: unified-diff line prefix per line kind (lookup, not a ternary chain). */
const DIFF_LINE_PREFIX: Record<string, string> = { added: '+', removed: '-', meta: '@' }

function formatDiffArtifact(artifact: Extract<Artifact, { kind: 'diff' }>): string {
  const lines: string[] = [`--- ${artifact.path}`, `+++ ${artifact.path}`]
  for (const hunk of artifact.hunks) {
    if (hunk.header !== undefined && hunk.header.length > 0) lines.push(hunk.header)
    for (const line of hunk.lines) {
      lines.push(`${DIFF_LINE_PREFIX[line.kind] ?? ' '}${line.content}`)
    }
  }
  return lines.join('\n')
}

/**
 * Convert an artifact into a Blob ready for `<a download>`. Image
 * data URLs are decoded to their underlying bytes so the file lands as
 * a native PNG/JPEG/etc rather than a base64 text file. URL-form
 * images return an empty Blob — the consumer should `fetch(url)` then
 * download themselves (cross-origin caveats).
 */
export function artifactToBlob(artifact: Artifact): Promise<Blob> {
  if (artifact.kind === 'image' && artifact.source === 'data') {
    const match = artifact.dataUrl.match(/^data:([^;]+);base64,(.+)$/i)
    if (match !== null) {
      const mime = match[1] ?? 'application/octet-stream'
      const b64 = match[2] ?? ''
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return Promise.resolve(new Blob([bytes], { type: mime }))
    }
  }
  const text = serializeArtifactForCopy(artifact)
  const mimeMap: Partial<Record<ArtifactKind, string>> = {
    markdown: 'text/markdown',
    code: 'text/plain',
    svg: 'image/svg+xml',
    mermaid: 'text/plain',
    html: 'text/html',
    'whiteboard-scene': 'application/json',
    'slide-deck': 'text/markdown',
    diff: 'text/plain',
  }
  const mime = mimeMap[artifact.kind] ?? 'application/octet-stream'
  return Promise.resolve(new Blob([text], { type: mime }))
}

/**
 * The filename to offer when downloading an artifact.
 *
 * Derived from title and kind, with an extension matching the kind so the file opens in the right
 * application instead of arriving as an extensionless blob.
 */
export function filenameFor(artifact: Artifact): string {
  const slug = slugifyFilename(artifact.title)
  const ext = pickExtension(artifact)
  const versionSuffix = artifact.version > 1 ? `-v${artifact.version}` : ''
  return `${slug}${versionSuffix}.${ext}`
}
