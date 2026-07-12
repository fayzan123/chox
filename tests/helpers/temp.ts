import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'

import type { ChoxPaths } from '../../src/paths.js'

const roots = new Set<string>()

export async function makeTempDir(prefix = 'chox-test-'): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), prefix))
  roots.add(dir)
  return dir
}

export function assertIsolatedPaths(paths: ChoxPaths): void {
  const home = resolve(homedir())
  for (const value of Object.values(paths)) {
    const rel = relative(home, resolve(value))
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      throw new Error(`test path resolves inside the real home directory: ${value}`)
    }
  }
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all([...roots].map(async (root) => rm(root, { recursive: true, force: true })))
  roots.clear()
}
