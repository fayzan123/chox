import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import type { RunState } from '../../src/harness/run-store.js'
import { resolvePaths } from '../../src/paths.js'
import { collectStatus, renderStatus } from '../../src/status.js'
import { assertIsolatedPaths, cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

function runState(overrides: Partial<RunState> & Pick<RunState, 'runId' | 'slug'>): RunState {
  return {
    repoRoot: '/tmp/example-repo',
    worktreePath: `/tmp/example-worktrees/${overrides.slug}-${overrides.runId}`,
    branch: `chox/${overrides.slug}/${overrides.runId}`,
    status: 'completed',
    currentHop: 0,
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
    ...overrides
  }
}

async function writeRun(
  runsDir: string,
  state: RunState,
  plan?: unknown,
  rawRunJson?: string
): Promise<string> {
  const dir = join(runsDir, state.slug, state.runId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'run.json'), rawRunJson ?? JSON.stringify(state))
  if (plan !== undefined) await writeFile(join(dir, 'plan.json'), JSON.stringify(plan))
  return dir
}

function plan(slug: string, hopCount: number): unknown {
  return { slug, hops: Array.from({ length: hopCount }, (_, index) => ({ index })) }
}

test('a missing Chox home reads as an empty status and is never created', async () => {
  const root = await makeTempDir()
  const home = join(root, 'never-created')
  const paths = resolvePaths({ CHOX_HOME: home })
  assertIsolatedPaths(paths)

  const report = await collectStatus(paths)

  expect(report).toEqual({
    runs: [],
    totalRuns: 0,
    unreadableRuns: 0,
    unreadablePlans: 0,
    worktrees: { total: 0, active: 0, orphaned: 0 }
  })
  await expect(access(home)).rejects.toThrow()
})

test('summarizes runs newest first with hop counts, and counts corrupt files', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  assertIsolatedPaths(paths)
  await writeRun(paths.runs, runState({
    runId: 'r-old', slug: 'demo', status: 'completed', currentHop: 3,
    updatedAt: '2026-07-13T10:00:00.000Z'
  }), plan('demo', 3))
  await writeRun(paths.runs, runState({
    runId: 'r-gate', slug: 'demo', status: 'awaiting-gate', currentHop: 1,
    updatedAt: '2026-07-13T12:00:00.000Z'
  }), plan('demo', 3))
  await writeRun(paths.runs, runState({
    runId: 'r-noplan', slug: 'other', status: 'failed', currentHop: 0,
    updatedAt: '2026-07-13T11:00:00.000Z'
  }))
  await writeRun(paths.runs, runState({ runId: 'r-corrupt', slug: 'demo' }), plan('demo', 1), '{not json')

  const report = await collectStatus(paths)

  expect(report.runs.map(({ runId }) => runId)).toEqual(['r-gate', 'r-noplan', 'r-old'])
  expect(report.totalRuns).toBe(3)
  expect(report.unreadableRuns).toBe(1)
  expect(report.unreadablePlans).toBe(1)
  expect(report.runs[0]).toMatchObject({
    slug: 'demo', status: 'awaiting-gate', currentHop: 1, totalHops: 3,
    branch: 'chox/demo/r-gate'
  })
  expect(report.runs[1]?.totalHops).toBeUndefined()
})

test('counts worktrees owned by non-terminal runs separately from orphans', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  assertIsolatedPaths(paths)
  const activeWorktree = join(paths.worktrees, 'demo-r-live')
  await mkdir(activeWorktree, { recursive: true })
  await mkdir(join(paths.worktrees, 'demo-r-stale'), { recursive: true })
  await writeRun(paths.runs, runState({
    runId: 'r-live', slug: 'demo', status: 'running', currentHop: 0,
    worktreePath: activeWorktree
  }), plan('demo', 2))
  await writeRun(paths.runs, runState({
    runId: 'r-done', slug: 'demo', status: 'completed', currentHop: 2,
    worktreePath: join(paths.worktrees, 'demo-r-stale')
  }), plan('demo', 2))

  const report = await collectStatus(paths)

  expect(report.worktrees).toEqual({ total: 2, active: 1, orphaned: 1 })
})

test('caps the listing at ten runs while totals count everything', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  assertIsolatedPaths(paths)
  for (let index = 0; index < 12; index += 1) {
    await writeRun(paths.runs, runState({
      runId: `r-${String(index).padStart(2, '0')}`, slug: 'demo',
      updatedAt: `2026-07-13T${String(index).padStart(2, '0')}:00:00.000Z`
    }), plan('demo', 1))
  }

  const report = await collectStatus(paths)

  expect(report.runs).toHaveLength(10)
  expect(report.totalRuns).toBe(12)
  expect(report.runs[0]?.runId).toBe('r-11')
})

test('renders an empty home as a friendly no-runs status', () => {
  const text = renderStatus({
    runs: [],
    totalRuns: 0,
    unreadableRuns: 0,
    unreadablePlans: 0,
    worktrees: { total: 0, active: 0, orphaned: 0 }
  })

  expect(text).toBe([
    'No runs yet. Start one with: chox run <slug>',
    'Worktrees: 0 total (0 from active runs, 0 orphaned)',
    'Substrate: not initialized — ships in Phase 1b',
    ''
  ].join('\n'))
})

test('renders runs with hop progress, resume commands, and corruption notes', () => {
  const text = renderStatus({
    runs: [
      {
        runId: 'r-gate', slug: 'demo', status: 'awaiting-gate', currentHop: 1,
        totalHops: 3, branch: 'chox/demo/r-gate', updatedAt: '2026-07-13T12:00:00.000Z'
      },
      {
        runId: 'r-noplan', slug: 'other', status: 'failed', currentHop: 0,
        totalHops: undefined, branch: 'chox/other/r-noplan', updatedAt: '2026-07-13T11:00:00.000Z'
      },
      {
        runId: 'r-old', slug: 'demo', status: 'completed', currentHop: 3,
        totalHops: 3, branch: 'chox/demo/r-old', updatedAt: '2026-07-13T10:00:00.000Z'
      }
    ],
    totalRuns: 3,
    unreadableRuns: 1,
    unreadablePlans: 1,
    worktrees: { total: 2, active: 1, orphaned: 1 }
  })

  expect(text).toBe([
    'Runs (showing 3 of 3, newest first):',
    '  demo/r-gate  awaiting-gate  hop 2/3  chox/demo/r-gate  updated 2026-07-13T12:00:00.000Z',
    '    resume: chox run demo --resume',
    '  other/r-noplan  failed  chox/other/r-noplan  updated 2026-07-13T11:00:00.000Z',
    '  demo/r-old  completed  hop 3/3  chox/demo/r-old  updated 2026-07-13T10:00:00.000Z',
    'Note: skipped 1 unreadable run.json file(s) and 1 unreadable plan.json file(s).',
    'Worktrees: 2 total (1 from active runs, 1 orphaned)',
    'Substrate: not initialized — ships in Phase 1b',
    ''
  ].join('\n'))
})
