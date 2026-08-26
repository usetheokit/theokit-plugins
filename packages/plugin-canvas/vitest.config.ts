import { cpus } from 'node:os'
import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  // Parameter decorators (`@Body`, `@Req`) emit metadata esbuild cannot produce — the same reason
  // `theokit build` requires @swc/core for a controller. Without this the suite fails to transform
  // rather than failing an assertion, which is a clearer signal but still a stop.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
  },
})
