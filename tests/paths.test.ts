import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { ensureChoxHome, isPathInside, resolvePaths } from '../src/paths.js'
import { assertIsolatedPaths, cleanupTempDirs, makeTempDir } from './helpers/temp.js'

afterEach(cleanupTempDirs)

test('recognizes resolved path containment without accepting prefix collisions', () => {
  expect(isPathInside('/a/b/c', '/a/b')).toBe(true)
  expect(isPathInside('/a/b', '/a/b')).toBe(true)
  expect(isPathInside('/a/bc', '/a/b')).toBe(false)
  expect(isPathInside('/a/b/../d', '/a/b')).toBe(false)
})

test('CHOX_HOME controls every state path and creates the required tree', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'state') })
  assertIsolatedPaths(paths)
  await ensureChoxHome(paths)
  await Promise.all([access(paths.runs), access(paths.worktrees), access(paths.relays)])
})

test('an unusable CHOX_HOME fails with an actionable error', async () => {
  const root = await makeTempDir()
  const file = join(root, 'not-a-directory')
  await writeFile(file, 'occupied')
  const paths = resolvePaths({ CHOX_HOME: file })
  await expect(ensureChoxHome(paths)).rejects.toThrow(/not writable.*CHOX_HOME/i)
})
