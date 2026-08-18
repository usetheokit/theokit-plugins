import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.ts',
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
    'theokit',
    '@theokit/sdk',
    '@theokit/plugin-realtime',
    '@theokit/plugin-rate-limit',
    '@theokit/plugin-canvas',
    '@theokit/plugin-voice',
    '@theokit/ui',
    'zod',
    'react',
  ],
})
