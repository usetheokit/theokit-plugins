import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: [
    'resend',
    'theokit',
    'react',
    '@react-email/render',
    '@react-email/components',
    '@theokit/auth-magic-link',
  ],
})
