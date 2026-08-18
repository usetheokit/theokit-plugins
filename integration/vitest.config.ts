import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Real APIs are slow and rate-limited. The default 5s is a false negative
    // waiting to happen; individual round trips raise this further.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One service at a time. Parallel files race for the same provider rate
    // limit, and that turns into flakiness that looks like a product bug.
    fileParallelism: false,
    sequence: { concurrent: false },
    // A live suite that retries hides an intermittent contract break, which is
    // exactly the thing these tests exist to catch.
    retry: 0,
  },
})
