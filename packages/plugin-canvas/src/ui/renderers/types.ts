import type { Artifact, ArtifactKind } from '../../schema.js'

/**
 * Common prop shape for per-kind renderers. The generic parameter
 * narrows the `artifact` field to the matching variant so renderers
 * never need to `switch` on `kind` themselves.
 */
export interface ArtifactRendererProps<K extends ArtifactKind = ArtifactKind> {
  artifact: Extract<Artifact, { kind: K }>
}

/**
 * Renderer registry entry — apps register custom renderers via
 * `<ArtifactRenderer renderers={{ kind: Component, … }}>`. Unknown
 * kinds fall back to a generic JSON dump (visible warning).
 */
export type ArtifactRendererComponent<K extends ArtifactKind = ArtifactKind> = (
  props: ArtifactRendererProps<K>,
) => React.ReactElement | null

/**
 * Per-kind renderer overrides — a partial map, so an app replaces only the kinds it cares about.
 *
 * The component type is indexed by kind, so a renderer registered under `'code'` receives a code
 * artifact and cannot be handed a whiteboard scene by mistake.
 */
export type ArtifactRendererRegistry = {
  [K in ArtifactKind]?: ArtifactRendererComponent<K>
}
