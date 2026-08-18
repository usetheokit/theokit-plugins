import { defineConfig } from 'tsup'

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
  external: [
    'react',
    'react-dom',
    '@theokit/ui',
    '@usetheo/ui',
    '@theokit/sdk',
    'mermaid',
    'theokit',
  ],
})
