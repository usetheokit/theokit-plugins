import { cpus } from 'node:os'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    setupFiles: ['./tests/setup.ts'],
    // Environment is set per-file via `@vitest-environment jsdom` so the
    // server-side tests (stt/tts/scaffold) keep running under the cheap
    // Node environment and only the React tests pay the jsdom cost.
    environment: 'node',
  },
})
