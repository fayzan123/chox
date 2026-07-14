import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import {
  renderOccurrenceChain,
  scanHandoff,
  scanHandoffReport
} from '../../src/lenses/handoff/scan.js'
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
  cwd?: string
}): void {
  store.upsertSource({ id: input.sourceId, kind: input.sourceId, rootPath: '/fixture' })
  const parsed: ParsedSession = {
    meta: {
      id: input.id,
      cwd: input.cwd ?? input.repoRoot,
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
    weight: 1.25,
    interleaved: false,
    sessions: [
      {
        sourceId: 'claude-code',
        startedAt: '2026-01-01T10:00:00.000Z',
        endedAt: '2026-01-01T10:10:00.000Z'
      },
      {
        sourceId: 'codex',
        startedAt: '2026-01-01T11:00:00.000Z',
        endedAt: '2026-01-01T11:20:00.000Z'
      },
      {
        sourceId: 'claude-code',
        startedAt: '2026-01-01T12:00:00.000Z',
        endedAt: '2026-01-01T12:30:00.000Z'
      }
    ]
  })
  expect(renderOccurrenceChain(candidates[0]!.occurrences[0]!))
    .toBe('claude-code → codex → claude-code')
  store.close()
})

test('excludes every session rooted in Chox worktrees before building candidates', async () => {
  const { store, root } = await storeFixture()
  const worktreesRoot = join(root, 'chox-home', 'worktrees')
  const repo = join(worktreesRoot, 'run-x')
  for (const [index, sourceId] of ['claude-code', 'codex', 'claude-code'].entries()) {
    addSession(store, {
      id: `tool-${index}`,
      sourceId: sourceId as 'claude-code' | 'codex',
      repoRoot: repo,
      startedAt: `2026-01-01T1${index}:00:00.000Z`,
      endedAt: `2026-01-01T1${index}:10:00.000Z`
    })
  }

  const report = await scanHandoffReport(store, { worktreesRoot })
  expect(report.surfaced).toEqual([])
  expect(report.subsumed).toEqual([])
  expect(report.toolInvokedExcluded).toBe(3)
  expect(report.belowFloor).toBe(0)
  store.close()
})

test('worktree exclusion prevents Chox runs from inflating organic occurrences', async () => {
  const { store, root } = await storeFixture()
  const worktreesRoot = join(root, 'chox-home', 'worktrees')
  for (const [repo, prefix, day] of [
    [join(root, 'organic-repo'), 'organic', '01'],
    [join(worktreesRoot, 'run-x'), 'tool', '02']
  ] as const) {
    for (const [index, sourceId] of ['claude-code', 'codex', 'claude-code'].entries()) {
      addSession(store, {
        id: `${prefix}-${index}`,
        sourceId: sourceId as 'claude-code' | 'codex',
        repoRoot: repo,
        startedAt: `2026-01-${day}T1${index}:00:00.000Z`,
        endedAt: `2026-01-${day}T1${index}:10:00.000Z`
      })
    }
  }

  const filtered = await scanHandoffReport(store, { worktreesRoot })
  expect(filtered.surfaced[0]?.evidence).toMatchObject({ occurrenceCount: 1, sessionCount: 3 })
  expect(filtered.toolInvokedExcluded).toBe(3)
  const unfiltered = await scanHandoffReport(store)
  expect(unfiltered.surfaced[0]?.evidence).toMatchObject({ occurrenceCount: 2, sessionCount: 6 })
  store.close()
})

test('marks and renders overlapping sessions without inventing strict sequence', async () => {
  const { store, root } = await storeFixture()
  const repo = join(root, 'repo')
  addSession(store, {
    id: 'plan', sourceId: 'claude-code', repoRoot: repo,
    startedAt: '2026-01-01T00:59:00.000Z', endedAt: '2026-01-01T05:44:00.000Z'
  })
  addSession(store, {
    id: 'build', sourceId: 'codex', repoRoot: repo,
    startedAt: '2026-01-01T01:07:00.000Z', endedAt: '2026-01-01T04:16:00.000Z'
  })
  addSession(store, {
    id: 'review', sourceId: 'claude-code', repoRoot: repo,
    startedAt: '2026-01-01T05:45:00.000Z', endedAt: '2026-01-01T05:55:00.000Z'
  })

  const occurrence = (await scanHandoff(store))[0]?.occurrences[0]
  expect(occurrence).toMatchObject({ interleaved: true })
  expect(occurrence?.sessions).toHaveLength(3)
  expect(occurrence && renderOccurrenceChain(occurrence))
    .toBe('claude-code ⇄ codex (concurrent) → claude-code')
  store.close()
})

test('scan reports below-floor patterns from the current pass only', async () => {
  const { store, root } = await storeFixture()
  const repo = join(root, 'repo')
  addSession(store, {
    id: 'plan', sourceId: 'claude-code', repoRoot: repo,
    startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:10:00.000Z'
  })
  addSession(store, {
    id: 'build', sourceId: 'codex', repoRoot: repo,
    startedAt: '2026-01-01T11:00:00.000Z', endedAt: '2026-01-01T11:10:00.000Z'
  })

  const report = await scanHandoffReport(store)
  expect(report.belowFloor).toBe(1)
  expect(report.surfaced).toEqual([])
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
