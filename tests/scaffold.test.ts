// Scaffold sanity test — replaced by real suites during Phase 1a.
// Exists so `vitest run` has at least one test from day one.
import { test, expect } from 'vitest'

test('runtime meets the engines floor (node >= 22.13, for node:sqlite)', () => {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
  expect(major > 22 || (major === 22 && minor >= 13)).toBe(true)
})
