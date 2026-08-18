import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
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
    'react-hook-form',
    '@hookform/resolvers',
    '@hookform/resolvers/zod',
    'zod',
    'theokit',
    '@theokit/react',
    '@theokit/ui',
    '@usetheo/ui',
  ],
})
