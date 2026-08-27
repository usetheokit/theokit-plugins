import { defineConfig } from 'tsup'

// Two entry points so the server-side plugin and the UI components live in
// separate dist trees and consumers can `import "@theokit/plugin-voice"`
// (server) vs `import "@theokit/plugin-voice/ui"` (browser-only) without
// pulling React into a Node-only deployment.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'ui/index': 'src/ui/index.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // tsup 8 strips the `node:` prefix by default (`removeNodeProtocol`), so
  // `node:crypto` would ship as bare `crypto` — which Deno, Bun and
  // Workers-style runtimes do not resolve (#38). The default flips in tsup 9.
  removeNodeProtocol: false,
  external: ['react', 'react-dom', '@theokit/http'],
})
