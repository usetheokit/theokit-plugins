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
    '@theokit/sdk/subscription',
    'zod',
    'yjs',
    'y-protocols',
    'y-protocols/awareness',
    'lib0',
    'react',
  ],
})
