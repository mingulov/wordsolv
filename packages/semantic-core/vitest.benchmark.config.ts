import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/benchmark.test.ts'], testTimeout: 600_000 },
})
