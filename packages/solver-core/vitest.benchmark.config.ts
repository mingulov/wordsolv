import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['src/benchmark.test.ts'],
    // Each test carries its own 600_000ms per-test timeout (see benchmark.test.ts);
    // this is just the project-level default for any test that doesn't override it.
    testTimeout: 120_000,
    // benchmark.test.ts's regression gates run fully synchronously for minutes at a time
    // (200-game simulations); Vitest's worker<->main RPC (`onTaskUpdate`) has a hardcoded,
    // non-configurable 60s ack timeout that a blocked event loop can blow past even though
    // no test actually fails. This suite has no real async code (solver-core is 100% sync),
    // so there is no genuine unhandled rejection this could mask — safe to ignore.
    //
    // This flag was root/run-level only in Vitest 3.2.7 (listed in `NonProjectOptions` and
    // stripped from `ProjectConfig`), so it could not be scoped inside a single `projects`
    // array entry — hence this fully separate config file, run as its own `vitest run`
    // invocation, instead of a project within vitest.config.ts.
    //
    // Carried forward unchanged through the Vitest 4.1.10 upgrade (2026-07-20): both gates
    // pass under v4 with this config as-is. Not re-tested is whether v4 still *needs* it —
    // `NonProjectOptions` no longer exists by that name in v4's types, so the split may now
    // be collapsible into vitest.config.ts. Verifying that costs a ~9-minute run; do it
    // before assuming this file is still load-bearing.
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
