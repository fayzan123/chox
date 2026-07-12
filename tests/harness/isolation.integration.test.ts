import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { resolvePaths } from '../../src/paths.js'
import {
  createWorktree,
  sweepOrphans,
  teardownWorktree
} from '../../src/harness/isolation.js'
import { createRun, saveState } from '../../src/harness/run-store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { git, initGitRepo } from '../helpers/git.js'

afterEach(cleanupTempDirs)

async function setup() {
  const root = await makeTempDir()
  const repoRoot = await initGitRepo(root)
  const paths = resolvePaths({ CHOX_HOME: join(root, 'home') })
  return { root, repoRoot, paths }
}

test('worktree creation isolates a branch and excludes harness artifacts per worktree', async () => {
  const { repoRoot, paths } = await setup()
  const wt = await createWorktree({ repoRoot, slug: 'demo', runId: 'run-1', paths })
  await mkdir(join(wt.path, '.chox-run'))
  await writeFile(join(wt.path, '.chox-run', 'secret.md'), 'ignored')

  expect(wt.branch).toBe('chox/demo/run-1')
  expect(await git(wt.path, 'status', '--porcelain')).toBe('')
  const excludes = await git(wt.path, 'config', '--worktree', '--get', 'core.excludesFile')
  expect(await readFile(excludes, 'utf8')).toContain('.chox-run/')
  await teardownWorktree(wt, { commitMessage: 'chox: clean test' })
})

test('teardown commits dirty work, removes the worktree, and preserves the branch', async () => {
  const { repoRoot, paths } = await setup()
  const wt = await createWorktree({ repoRoot, slug: 'demo', runId: 'run-1', paths })
  await writeFile(join(wt.path, 'README.md'), '# preserved\n')
  await writeFile(join(wt.path, 'new file.txt'), 'new\n')

  const result = await teardownWorktree(wt, { commitMessage: 'chox: preserve run-1' })
  expect(result.committed).toBe(true)
  await expect(access(wt.path)).rejects.toThrow()
  expect(await git(repoRoot, 'show', `${wt.branch}:README.md`)).toBe('# preserved')
  expect(await git(repoRoot, 'show', `${wt.branch}:new file.txt`)).toBe('new')
})

test('clean teardown creates no empty commit', async () => {
  const { repoRoot, paths } = await setup()
  const before = await git(repoRoot, 'rev-list', '--count', 'HEAD')
  const wt = await createWorktree({ repoRoot, slug: 'demo', runId: 'run-1', paths })
  const result = await teardownWorktree(wt, { commitMessage: 'chox: no empty commit' })
  expect(result.committed).toBe(false)
  expect(await git(repoRoot, 'rev-list', '--count', wt.branch)).toBe(before)
})

test('orphan sweep commits dirty terminal worktrees before removing them', async () => {
  const { repoRoot, paths } = await setup()
  const wt = await createWorktree({ repoRoot, slug: 'demo', runId: 'run-1', paths })
  const run = await createRun('demo', {
    runId: 'run-1',
    repoRoot,
    worktreePath: wt.path,
    branch: wt.branch
  }, paths)
  await writeFile(join(wt.path, 'orphan.txt'), 'must survive\n')
  await saveState(run, { status: 'failed' })
  await run.events.close()

  const result = await sweepOrphans('demo', paths)
  expect(result.swept).toContain(wt.path)
  await expect(access(wt.path)).rejects.toThrow()
  expect(await git(repoRoot, 'show', `${wt.branch}:orphan.txt`)).toBe('must survive')
})

test('a repository without HEAD gets an actionable error', async () => {
  const root = await makeTempDir()
  const repoRoot = join(root, 'empty-repo')
  await mkdir(repoRoot)
  await git(repoRoot, 'init')
  const paths = resolvePaths({ CHOX_HOME: join(root, 'home') })
  await expect(createWorktree({ repoRoot, slug: 'demo', runId: 'run-1', paths }))
    .rejects.toThrow(/no commits.*initial commit/i)
})

test('branch collisions receive a deterministic numeric suffix', async () => {
  const { repoRoot, paths } = await setup()
  await git(repoRoot, 'branch', 'chox/demo/run-1')
  const wt = await createWorktree({ repoRoot, slug: 'demo', runId: 'run-1', paths })
  expect(wt.branch).toBe('chox/demo/run-1-2')
  await teardownWorktree(wt, { commitMessage: 'chox: collision test' })
})

test('a manually deleted worktree is warned about and pruned without crashing', async () => {
  const { repoRoot, paths } = await setup()
  const wt = await createWorktree({ repoRoot, slug: 'demo', runId: 'run-1', paths })
  const run = await createRun('demo', {
    runId: 'run-1',
    repoRoot,
    worktreePath: wt.path,
    branch: wt.branch
  }, paths)
  await run.events.close()
  await rm(wt.path, { recursive: true, force: true })
  const result = await sweepOrphans('demo', paths)
  expect(result.warnings.join('\n')).toMatch(/missing.*worktree/i)
})
