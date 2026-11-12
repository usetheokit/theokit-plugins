import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The seam test imports the sibling's public entry, which its `exports` map points at
    // `dist/`. Coverage runs (the SonarQube job) do not build first, so that import failed to
    // resolve. Resolving to the sibling's source runs the same code without needing a build.
    alias: {
      '@theokit/auth-magic-link': fileURLToPath(
        new URL('../auth-magic-link/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
})
