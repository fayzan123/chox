import { readFile } from 'node:fs/promises'

import { expect, test } from 'vitest'

interface PackageManifest {
  name?: unknown
  version?: unknown
  private?: unknown
  bin?: Record<string, unknown>
  files?: unknown
  repository?: { url?: unknown }
}

interface PackageLock {
  name?: unknown
  version?: unknown
  packages?: Record<string, { name?: unknown, version?: unknown }>
}

test('public package metadata and lock identity agree while the command remains chox', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  ) as PackageManifest
  const lock = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')
  ) as PackageLock

  expect(manifest.name).toBe('chox-cli')
  expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
  expect(manifest.private).not.toBe(true)
  expect(manifest.bin).toEqual({ chox: 'dist/bin/chox.js' })
  expect(manifest.files).toContain('relays')
  expect(manifest.repository?.url).toBe('git+https://github.com/fayzan123/chox.git')
  expect(lock.name).toBe(manifest.name)
  expect(lock.version).toBe(manifest.version)
  expect(lock.packages?.['']?.name).toBe(manifest.name)
  expect(lock.packages?.['']?.version).toBe(manifest.version)
})
