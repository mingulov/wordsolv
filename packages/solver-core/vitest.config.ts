import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'dict/**/*.test.ts'],
    exclude: ['src/benchmark.test.ts'],
    testTimeout: 120_000,
  },
})
