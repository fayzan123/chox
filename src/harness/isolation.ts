import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { ChoxError } from '../errors.js'
import { ensureChoxHome, type ChoxPaths } from '../paths.js'
import type { RunState } from './run-store.js'
import { runGit } from '../system/command.js'

export interface Worktree {
  path: string
  branch: string
  repoRoot: string
  baseCommit: string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function availableBranch(repoRoot: string, base: string): Promise<string> {
  let suffix = 1
  while (true) {
    const branch = suffix === 1 ? base : `${base}-${suffix}`
    const found = await runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      allowFailure: true
    })
    if (found.code !== 0) return branch
    suffix += 1
  }
}

async function configureArtifactExclude(worktree: string, repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['config', 'extensions.worktreeConfig', 'true'])
  const gitDirResult = await runGit(worktree, ['rev-parse', '--git-dir'])
  const rawGitDir = gitDirResult.stdout.trim()
  const gitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(worktree, rawGitDir)
  const excludePath = join(gitDir, 'info', 'exclude')
  await mkdir(dirname(excludePath), { recursive: true })
  await writeFile(excludePath, '.chox-run/\n', { flag: 'wx' })
  await runGit(worktree, ['config', '--worktree', 'core.excludesFile', excludePath])
}

export async function createWorktree(opts: {
  repoRoot: string
  slug: string
  runId: string
  paths: ChoxPaths
}): Promise<Worktree> {
  await ensureChoxHome(opts.paths)
  const rootResult = await runGit(opts.repoRoot, ['rev-parse', '--show-toplevel'], { allowFailure: true })
  if (rootResult.code !== 0) {
    throw new ChoxError(`chox run must be invoked inside a Git repository: ${opts.repoRoot}`, 2)
  }
  const repoRoot = rootResult.stdout.trim()
  const head = await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
  if (head.code !== 0) {
    throw new ChoxError(
      'This repository has no commits. Create an initial commit before starting an isolated Chox run.',
      2
    )
  }

  const path = join(opts.paths.worktrees, `${opts.slug}-${opts.runId}`)
  if (await pathExists(path)) {
    throw new ChoxError(`Worktree destination already exists: ${path}`)
  }
  const branch = await availableBranch(repoRoot, `chox/${opts.slug}/${opts.runId}`)
  await runGit(repoRoot, ['worktree', 'add', '-b', branch, path, 'HEAD'])
  try {
    await configureArtifactExclude(path, repoRoot)
  } catch (error) {
    await runGit(repoRoot, ['worktree', 'remove', '--force', path], { allowFailure: true })
    throw error
  }
  return { path, branch, repoRoot, baseCommit: head.stdout.trim() }
}

export async function teardownWorktree(
  wt: Worktree,
  opts: { commitMessage: string }
): Promise<{ committed: boolean }> {
  if (!await pathExists(wt.path)) {
    await runGit(wt.repoRoot, ['worktree', 'prune'], { allowFailure: true })
    return { committed: false }
  }
  const status = await runGit(wt.path, ['status', '--porcelain=v1', '--untracked-files=all'])
  let committed = false
  if (status.stdout.trim() !== '') {
    await runGit(wt.path, ['add', '-A'])
    const staged = await runGit(wt.path, ['diff', '--cached', '--quiet'], { allowFailure: true })
    if (staged.code !== 0) {
      await runGit(wt.path, ['commit', '--no-verify', '-m', opts.commitMessage])
      committed = true
    }
  }
  await runGit(wt.repoRoot, ['worktree', 'remove', '--force', wt.path])
  return { committed }
}

interface StoredRun {
  state?: RunState
  dir: string
}

async function loadRuns(slug: string, paths: ChoxPaths): Promise<StoredRun[]> {
  const parent = join(paths.runs, slug)
  let entries: string[]
  try {
    entries = await readdir(parent)
  } catch {
    return []
  }
  const runs: StoredRun[] = []
  for (const entry of entries) {
    const dir = join(parent, entry)
    try {
      const state = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')) as RunState
      runs.push({ state, dir })
    } catch {
      runs.push({ dir })
    }
  }
  return runs
}

async function inferWorktree(path: string): Promise<Worktree> {
  const commonResult = await runGit(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const common = commonResult.stdout.trim()
  const repoRoot = dirname(isAbsolute(common) ? common : resolve(path, common))
  const branchResult = await runGit(path, ['branch', '--show-current'])
  const baseResult = await runGit(repoRoot, [
    'merge-base',
    branchResult.stdout.trim(),
    'HEAD'
  ])
  return {
    path,
    repoRoot,
    branch: branchResult.stdout.trim(),
    baseCommit: baseResult.stdout.trim()
  }
}

export async function sweepOrphans(
  slug: string,
  paths: ChoxPaths
): Promise<{ swept: string[], warnings: string[] }> {
  const swept: string[] = []
  const warnings: string[] = []
  const runs = await loadRuns(slug, paths)
  const byWorktree = new Map(
    runs.flatMap((run) => run.state ? [[resolve(run.state.worktreePath), run] as const] : [])
  )
  const repositories = new Set(runs.flatMap((run) => run.state ? [run.state.repoRoot] : []))

  let worktreeNames: string[] = []
  try {
    worktreeNames = (await readdir(paths.worktrees)).filter((name) => name.startsWith(`${slug}-`))
  } catch {
    // No Chox home yet means there can be no worktrees to sweep.
  }
  const terminal = new Set(['completed', 'aborted', 'failed'])
  for (const name of worktreeNames) {
    const path = resolve(paths.worktrees, name)
    const run = byWorktree.get(path)
    if (run?.state && !terminal.has(run.state.status)) continue
    try {
      const wt = run?.state
        ? {
            path,
            branch: run.state.branch,
            repoRoot: run.state.repoRoot,
            baseCommit: run.state.baseCommit ?? run.state.branch
          }
        : await inferWorktree(path)
      repositories.add(wt.repoRoot)
      await teardownWorktree(wt, { commitMessage: `chox: preserve orphaned ${slug} run` })
      swept.push(path)
    } catch (error) {
      warnings.push(`Could not safely sweep orphan ${path}: ${String(error)}`)
    }
  }

  for (const run of runs) {
    if (run.state && !await pathExists(run.state.worktreePath) && !terminal.has(run.state.status)) {
      warnings.push(`Run ${run.state.runId} has a missing worktree: ${run.state.worktreePath}`)
    }
  }
  for (const repo of repositories) {
    const result = await runGit(repo, ['worktree', 'prune'], { allowFailure: true })
    if (result.code !== 0) warnings.push(`Could not prune Git worktrees in ${repo}`)
  }
  return { swept, warnings }
}
