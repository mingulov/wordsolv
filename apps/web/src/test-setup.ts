import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react only auto-registers its afterEach(cleanup) when it
// finds a global `afterEach`; this project doesn't enable vitest's `globals`,
// so tests that render more than once per file (reusing the same testids
// across `it` blocks) would otherwise see stale DOM from earlier renders.
afterEach(() => cleanup())
