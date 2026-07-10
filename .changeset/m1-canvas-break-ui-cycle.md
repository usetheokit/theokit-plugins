---
"@theokit/plugin-canvas": patch
---

Break the `canvas-panel` ↔ `canvas-toolbar` circular dependency by extracting the shared
`CanvasPanelToolbarAction` union into a leaf module (`ui/canvas-panel-actions`). The public
`@theokit/plugin-canvas/ui` export surface is unchanged. Also removed a dead `?? 'h1'`
fallback in the markdown renderer (the template literal is never nullish).
