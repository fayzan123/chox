import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, test } from 'vitest'

import { resolvePaths } from '../../src/paths.js'
import type { ParsedSession, SessionRef, SessionSource } from '../../src/sources/source.js'
import { scanSessionSources } from '../../src/sources/source.js'
import { openSubstrate } from '../../src/substrate/store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

function parsed(id: string, cwd: string, digest = 'alpha beta'): ParsedSession {
  return {
    meta: {
      id,
      cwd,
      repoRoot: cwd,
      originator: 'test',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:10:00.000Z',
      metadata: { safe: true }
    },
    units: [{
      id: `${id}:session`,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:10:00.000Z',
      intentDigest: digest,
      metadata: {}
    }],
    diagnostics: { unknownTypes: {}, nullLines: 0, failedFiles: [] }
  }
}

test('creates the canonical schema idempotently with a private database mode', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  let store = openSubstrate(paths)
  store.upsertSource({ id: 'test', kind: 'test', rootPath: root })
  store.replaceSession('test', 'ref-1', parsed('session-1', root))
  store.close()

  expect((await stat(paths.substrate)).mode & 0o777).toBe(0o600)
  store = openSubstrate(paths)
  expect(store.listSessions()).toHaveLength(1)
  store.close()

  const db = new DatabaseSync(paths.substrate, { readOnly: true })
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
  `).all().map((row) => (row as { name: string }).name)
  expect(tables).toEqual(['artifacts', 'findings', 'sessions', 'sources', 'units', 'watermarks'])
  const columns = db.prepare('PRAGMA table_info(units)').all()
    .map((row) => (row as { name: string }).name)
  expect(columns).toContain('intent_digest')
  expect(columns).not.toContain('content')
  expect(columns).not.toContain('prompt')
  db.close()
})

test('reports a corrupt database as a rebuildable cache with an actionable path', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  await mkdir(paths.home, { recursive: true })
  await writeFile(paths.substrate, 'not sqlite')
  expect(() => openSubstrate(paths)).toThrow(/delete .*substrate\.db.*rebuild.*cache/i)
})

test('adds source diagnostics to an existing substrate schema without rebuilding it', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  await mkdir(paths.home, { recursive: true })
  const oldDb = new DatabaseSync(paths.substrate)
  oldDb.exec(`
    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      root_path TEXT NOT NULL,
      last_scan_at TEXT
    )
  `)
  oldDb.close()

  const store = openSubstrate(paths)
  store.upsertSource({
    id: 'codex',
    kind: 'codex',
    rootPath: root,
    diagnostics: { unknownTypes: { future: 1 }, nullLines: 2, failedFiles: [] }
  })
  expect(store.listSources()[0]?.diagnostics).toEqual({
    unknownTypes: { future: 1 }, nullLines: 2, failedFiles: []
  })
  store.close()
})

test('finding upserts preserve dismissals and exported state', async () => {
  const root = await makeTempDir()
  const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  const finding = {
    id: 'finding-1', lens: 'handoff', kind: 'relay',
    createdAt: '2026-01-01T00:00:00.000Z', status: 'suggested' as const,
    payload: { version: 1 }
  }
  store.upsertFinding(finding)
  expect(store.updateFindingStatus(finding.id, 'dismissed')).toBe(true)
  store.upsertFinding({ ...finding, payload: { version: 2 } })
  expect(store.getFinding(finding.id)).toMatchObject({
    status: 'dismissed', payload: { version: 2 }
  })
  store.close()
})

describe('incremental source scan', () => {
  test('skips unchanged files and reparses only the touched file', async () => {
    const root = await makeTempDir()
    const home = join(root, 'fake-home')
    const first = join(home, 'one.jsonl')
    const second = join(home, 'two.jsonl')
    await mkdir(home, { recursive: true })
    await writeFile(first, '{}\n')
    await writeFile(second, '{}\n')
    let parseCount = 0
    const source: SessionSource = {
      id: 'test-source',
      async discover(): Promise<SessionRef[]> {
        return Promise.all([first, second].map(async (fileRef) => {
          const info = await stat(fileRef)
          return { sourceId: 'test-source', fileRef, mtime: Math.trunc(info.mtimeMs), size: info.size }
        }))
      },
      async parse(ref): Promise<ParsedSession> {
        parseCount += 1
        return parsed(`session-${ref.fileRef.endsWith('one.jsonl') ? 'one' : 'two'}`, root)
      }
    }
    const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))

    const firstScan = await scanSessionSources({ store, sources: [source], homeDir: home })
    expect(firstScan[0]).toMatchObject({ parsedFiles: 2, unchangedFiles: 0, sessionsStored: 2 })
    expect(parseCount).toBe(2)
    const secondScan = await scanSessionSources({ store, sources: [source], homeDir: home })
    expect(secondScan[0]).toMatchObject({ parsedFiles: 0, unchangedFiles: 2 })
    expect(parseCount).toBe(2)

    await appendFile(second, 'changed\n')
    const thirdScan = await scanSessionSources({ store, sources: [source], homeDir: home })
    expect(thirdScan[0]).toMatchObject({ parsedFiles: 1, unchangedFiles: 1 })
    expect(parseCount).toBe(3)
    expect(store.listSessions()).toHaveLength(2)
    store.close()
  })
})
