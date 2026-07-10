import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    environmentMatchGlobs: [['tests/react/**', 'jsdom']],
  },
})
