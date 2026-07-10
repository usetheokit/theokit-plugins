import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: [
    '@theokit/orm',
    'drizzle-orm',
    'drizzle-kit',
    'reflect-metadata',
    'theokit',
    'node:child_process',
    'node:path',
    'node:fs',
  ],
})
