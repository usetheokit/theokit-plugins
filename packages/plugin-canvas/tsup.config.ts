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
