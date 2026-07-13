import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { scanHandoff } from '../../src/lenses/handoff/scan.js'
import { resolvePaths } from '../../src/paths.js'
import type { ParsedSession } from '../../src/sources/source.js'
import { openSubstrate, type SubstrateStore } from '../../src/substrate/store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { initGitRepo } from '../helpers/git.js'

afterEach(cleanupTempDirs)

function addSession(store: SubstrateStore, input: {
  id: string
  sourceId: 'claude-code' | 'codex'
  repoRoot: string
  startedAt: string
  endedAt: string
  digest?: string
  originator?: string
  toolInvoked?: boolean
}): void {
  store.upsertSource({ id: input.sourceId, kind: input.sourceId, rootPath: '/fixture' })
  const parsed: ParsedSession = {
    meta: {
      id: input.id,
      cwd: input.repoRoot,
      repoRoot: input.repoRoot,
      ...(input.originator ? { originator: input.originator } : {}),
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      metadata: { toolInvoked: input.toolInvoked ?? false }
    },
    units: [{
      id: `${input.id}:session`,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      intentDigest: input.digest ?? input.id,
      metadata: {}
    }],
    diagnostics: { unknownTypes: {}, nullLines: 0, failedFiles: [] }
  }
  store.replaceSession(input.sourceId, `/fixtures/${input.id}.jsonl`, parsed)
}

async function storeFixture(): Promise<{ store: SubstrateStore, root: string }> {
  const root = await makeTempDir()
  return {
    root,
    store: openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  }
}

test('surfaces a three-session cross-source loop with honest evidence', async () => {
  const { store, root } = await storeFixture()
  const repo = join(root, 'missing-repo')
  addSession(store, {
    id: 'plan', sourceId: 'claude-code', repoRoot: repo,
    startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:10:00.000Z', digest: 'plan feature'
  })
  addSession(store, {
    id: 'implement', sourceId: 'codex', repoRoot: repo,
    startedAt: '2026-01-01T11:00:00.000Z', endedAt: '2026-01-01T11:20:00.000Z', digest: 'build feature'
  })
  addSession(store, {
    id: 'review', sourceId: 'claude-code', repoRoot: repo,
    startedAt: '2026-01-01T12:00:00.000Z', endedAt: '2026-01-01T12:30:00.000Z', digest: 'review changes'
  })

  const candidates = await scanHandoff(store)
  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({
    pattern: 'claude-code>codex>claude-code',
    surfaced: true,
    evidence: {
      occurrenceCount: 1,
      sessionCount: 3,
      dates: ['2026-01-01'],
      repos: [repo],
      totalMinutes: 60,
      medianMinutes: 60
    }
  })
  expect(candidates[0]?.occurrences[0]).toMatchObject({
    continuationPairs: 2,
    gitCorrelated: false,
    weight: 1.25
  })
  store.close()
})

test('stores but does not surface a two-session pattern on one repo', async () => {
  const { store, root } = await storeFixture()
  const repo = join(root, 'missing-repo')
  addSession(store, {
    id: 'plan', sourceId: 'claude-code', repoRoot: repo,
    startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:10:00.000Z'
  })
  addSession(store, {
    id: 'implement', sourceId: 'codex', repoRoot: repo,
    startedAt: '2026-01-01T11:00:00.000Z', endedAt: '2026-01-01T11:10:00.000Z'
  })

  expect(await scanHandoff(store)).toEqual([])
  const stored = store.listFindings({ kind: 'handoff-candidate' })
  expect(stored).toHaveLength(1)
  expect(stored[0]?.payload).toMatchObject({ surfaced: false })
  store.close()
})

test('the same two-session shape surfaces across two repos', async () => {
  const { store, root } = await storeFixture()
  for (const [index, repo] of [join(root, 'repo-a'), join(root, 'repo-b')].entries()) {
    addSession(store, {
      id: `plan-${index}`, sourceId: 'claude-code', repoRoot: repo,
      startedAt: `2026-01-0${index + 1}T10:00:00.000Z`,
      endedAt: `2026-01-0${index + 1}T10:10:00.000Z`
    })
    addSession(store, {
      id: `build-${index}`, sourceId: 'codex', repoRoot: repo,
      startedAt: `2026-01-0${index + 1}T11:00:00.000Z`,
      endedAt: `2026-01-0${index + 1}T11:10:00.000Z`
    })
  }
  const candidates = await scanHandoff(store)
  expect(candidates).toHaveLength(1)
  expect(candidates[0]?.evidence.repos).toHaveLength(2)
  store.close()
})

test('does not make single-source chains and excludes Chox-invoked Codex sessions', async () => {
  const { store, root } = await storeFixture()
  const repo = join(root, 'repo')
  addSession(store, {
    id: 'claude-1', sourceId: 'claude-code', repoRoot: repo,
    startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:10:00.000Z'
  })
  addSession(store, {
    id: 'automated', sourceId: 'codex', repoRoot: repo,
    startedAt: '2026-01-01T11:00:00.000Z', endedAt: '2026-01-01T11:10:00.000Z',
    originator: 'codex_exec', toolInvoked: true
  })
  addSession(store, {
    id: 'claude-2', sourceId: 'claude-code', repoRoot: repo,
    startedAt: '2026-01-01T12:00:00.000Z', endedAt: '2026-01-01T12:10:00.000Z'
  })
  expect(await scanHandoff(store)).toEqual([])
  expect(store.listFindings()).toEqual([])
  store.close()
})

test('git correlation raises occurrence weight and a missing repo remains neutral', async () => {
  const { store, root } = await storeFixture()
  const repo = await initGitRepo(root)
  const missing = join(root, 'missing')
  await mkdir(missing)
  const now = Date.now()
  const iso = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  for (const [prefix, repoRoot] of [['git', repo], ['neutral', missing]] as const) {
    addSession(store, {
      id: `${prefix}-a`, sourceId: 'claude-code', repoRoot,
      startedAt: iso(-20), endedAt: iso(-10), digest: 'plan alpha'
    })
    addSession(store, {
      id: `${prefix}-b`, sourceId: 'codex', repoRoot,
      startedAt: iso(-9), endedAt: iso(-5), digest: 'build beta'
    })
    addSession(store, {
      id: `${prefix}-c`, sourceId: 'claude-code', repoRoot,
      startedAt: iso(-4), endedAt: iso(-1), digest: 'review gamma'
    })
  }
  const candidate = (await scanHandoff(store))[0]
  expect(candidate).toBeDefined()
  const correlated = candidate?.occurrences.find(({ repoRoot }) => repoRoot === repo)
  const neutral = candidate?.occurrences.find(({ repoRoot }) => repoRoot === missing)
  expect(correlated?.gitCorrelated).toBe(true)
  expect(neutral?.gitCorrelated).toBe(false)
  expect(correlated?.weight ?? 0).toBeGreaterThan(neutral?.weight ?? 0)
  store.close()
})
