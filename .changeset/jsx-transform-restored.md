---
'@theokit/plugin-forms': patch
---

`TheoForm` renders again. `0.5.1` shipped with five bare `React.createElement` calls and no `React` import, so any page mounting the component died with `ReferenceError: React is not defined` — and an error boundary took the whole route down with it.

Nothing in this package changed; its build did. `emitDecoratorMetadata` had been added to the shared `tsconfig.base.json` for three unrelated packages, and that flag makes tsup abandon the automatic JSX transform. The flag now lives only where it is needed.
