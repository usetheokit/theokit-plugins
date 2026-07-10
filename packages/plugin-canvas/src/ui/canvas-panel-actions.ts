/**
 * Leaf module holding the shared toolbar-action union for the canvas panel.
 *
 * Extracted from `canvas-panel.tsx` to break the `canvas-panel` ↔ `canvas-toolbar`
 * import cycle: both files now type-import this leaf (which imports nothing from
 * its own package), so neither imports the other for this type. `ui/index.ts`
 * re-exports the name unchanged, so the public `@theokit/plugin-canvas/ui`
 * surface is preserved.
 */
export type CanvasPanelToolbarAction = 'copy' | 'download' | 'fork' | 'close'
