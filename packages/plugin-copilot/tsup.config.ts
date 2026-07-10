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
