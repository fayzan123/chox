import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, test } from 'vitest'

import { claudeCodeSource } from '../../src/sources/claude-code.js'
import { choxCodexOriginators, codexSource } from '../../src/sources/codex.js'
import type { SessionRef, SessionSource } from '../../src/sources/source.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

const claudeFixtures = fileURLToPath(new URL('../../fixtures/claude-code/', import.meta.url))
const codexFixtures = fileURLToPath(new URL('../../fixtures/codex/', import.meta.url))

async function ref(sourceId: string, fileRef: string): Promise<SessionRef> {
  const info = await stat(fileRef)
  return { sourceId, fileRef, mtime: Math.trunc(info.mtimeMs), size: info.size }
}

async function parseFixtureSet(source: SessionSource, root: string, count: number) {
  const parsed = []
  for (let index = 1; index <= count; index += 1) {
    const file = join(root, `session-${String(index).padStart(3, '0')}.jsonl`)
    parsed.push(await source.parse(await ref(source.id, file)))
  }
  return parsed
}

test('the committed founder fixtures parse to the expected session and unit counts', async () => {
  const claude = await parseFixtureSet(claudeCodeSource, claudeFixtures, 181)
  const codex = await parseFixtureSet(codexSource, codexFixtures, 38)

  expect(claude).toHaveLength(181)
  expect(codex).toHaveLength(38)
  expect(claude.filter(({ units }) => units.length === 1)).toHaveLength(181)
  expect(codex.filter(({ units }) => units.length === 1)).toHaveLength(38)
  expect(claude.every(({ units }) => units[0]?.intentDigest.startsWith('fp'))).toBe(true)
  expect(codex.every(({ units }) => units[0]?.intentDigest.startsWith('fp'))).toBe(true)

  const claudeRepos = new Set(claude.map(({ meta }) => meta.repoRoot))
  const codexRepos = new Set(codex.map(({ meta }) => meta.repoRoot))
  expect([...claudeRepos].filter((repo) => codexRepos.has(repo)).length).toBeGreaterThanOrEqual(3)
})

describe('schema drift', () => {
  test('Claude counts null, unknown, and truncated lines without crashing', async () => {
    const root = await makeTempDir()
    const file = join(root, 'claude.jsonl')
    await writeFile(file, [
      'null',
      JSON.stringify({
        type: 'user', timestamp: '2026-01-01T00:00:00.000Z', cwd: root,
        message: { role: 'user', content: 'Plan an alpha feature' }
      }),
      JSON.stringify({ type: 'future-entry', timestamp: '2026-01-01T00:01:00.000Z' }),
      '{"type":',
      ''
    ].join('\n'))

    const parsed = await claudeCodeSource.parse(await ref('claude-code', file))
    expect(parsed.units).toHaveLength(1)
    expect(parsed.diagnostics.nullLines).toBe(1)
    expect(parsed.diagnostics.unknownTypes).toMatchObject({ 'future-entry': 1 })
    expect(parsed.diagnostics.failedFiles).toEqual([file])
  })

  test('Codex tolerates null, unknown, truncated, and missing session_meta lines', async () => {
    const root = await makeTempDir()
    const file = join(root, 'codex.jsonl')
    await writeFile(file, [
      'null',
      JSON.stringify({
        type: 'response_item', timestamp: '2026-01-01T00:00:00.000Z',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build beta' }] }
      }),
      JSON.stringify({ type: 'future-entry', timestamp: '2026-01-01T00:01:00.000Z', payload: {} }),
      '{',
      ''
    ].join('\n'))

    const parsed = await codexSource.parse(await ref('codex', file))
    expect(parsed.units).toHaveLength(1)
    expect(parsed.meta.originator).toBeUndefined()
    expect(parsed.diagnostics.nullLines).toBe(1)
    expect(parsed.diagnostics.unknownTypes).toMatchObject({ 'future-entry': 1 })
    expect(parsed.diagnostics.failedFiles).toEqual([file])
  })

  test('marks the verified Chox Codex originator as tool-invoked metadata', async () => {
    const root = await makeTempDir()
    const file = join(root, 'codex.jsonl')
    await writeFile(file, [
      JSON.stringify({
        type: 'session_meta', timestamp: '2026-01-01T00:00:00.000Z',
        payload: { cwd: root, originator: 'codex_exec' }
      }),
      JSON.stringify({
        type: 'response_item', timestamp: '2026-01-01T00:01:00.000Z',
        payload: { type: 'message', role: 'user', content: 'Review gamma' }
      })
    ].join('\n'))
    const parsed = await codexSource.parse(await ref('codex', file))
    expect(choxCodexOriginators.has('codex_exec')).toBe(true)
    expect(parsed.meta.metadata).toMatchObject({ toolInvoked: true })
  })
})

test('source discovery uses only the provided fake home', async () => {
  const root = await makeTempDir()
  const claudeTarget = join(root, '.claude', 'projects', 'repo', 'one.jsonl')
  const codexTarget = join(root, '.codex', 'sessions', '2026', '01', '01', 'two.jsonl')
  await mkdir(dirname(claudeTarget), { recursive: true })
  await mkdir(dirname(codexTarget), { recursive: true })
  await copyFile(join(claudeFixtures, 'session-001.jsonl'), claudeTarget)
  await copyFile(join(codexFixtures, 'session-001.jsonl'), codexTarget)

  expect((await claudeCodeSource.discover(root)).map(({ fileRef }) => fileRef)).toEqual([claudeTarget])
  expect((await codexSource.discover(root)).map(({ fileRef }) => fileRef)).toEqual([codexTarget])
  expect(await readFile(claudeTarget, 'utf8')).toContain('<redacted:user-intent>')
})
