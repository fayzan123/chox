import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import type { Deviation } from './autonomy.js'
import { createEventWriter, type RunEventWriter } from './run-events.js'
import { ensureChoxHome, resolvePaths, type ChoxPaths } from '../paths.js'

export type RunStatus = 'running' | 'awaiting-gate' | 'completed' | 'aborted' | 'failed'

export interface RunState {
  runId: string
  slug: string
  repoRoot: string
  worktreePath: string
  branch: string
  status: RunStatus
  currentHop: number
  gate?: {
    hop: number
    deviations: Deviation[]
    blocking: boolean
    exitCode: number
  } | undefined
  createdAt: string
  updatedAt: string
}

export interface RunHandle {
  state: RunState
  dir: string
  events: RunEventWriter
}

export interface RunInit {
  runId: string
  repoRoot: string
  worktreePath: string
  branch: string
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    try {
      const { rm } = await import('node:fs/promises')
      await rm(temporary, { force: true })
    } catch {
      // Preserve the original atomic-write error.
    }
    throw error
  }
}

export async function createRun(
  slug: string,
  init: RunInit,
  paths: ChoxPaths = resolvePaths()
): Promise<RunHandle> {
  await ensureChoxHome(paths)
  const parent = join(paths.runs, slug)
  await mkdir(parent, { recursive: true })
  const dir = join(parent, init.runId)
  await mkdir(dir, { recursive: false })
  const now = new Date().toISOString()
  const state: RunState = {
    ...init,
    slug,
    status: 'running',
    currentHop: 0,
    createdAt: now,
    updatedAt: now
  }
  await writeJsonAtomic(join(dir, 'run.json'), state)
  return { state, dir, events: createEventWriter(join(dir, 'events.jsonl')) }
}

export async function saveState(handle: RunHandle, patch: Partial<RunState>): Promise<void> {
  const next: RunState = {
    ...handle.state,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString()
  }
  await writeJsonAtomic(join(handle.dir, 'run.json'), next)
  handle.state = next
}

function isRunState(value: unknown): value is RunState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Partial<RunState>
  return typeof state.runId === 'string'
    && typeof state.slug === 'string'
    && typeof state.repoRoot === 'string'
    && typeof state.worktreePath === 'string'
    && typeof state.branch === 'string'
    && typeof state.currentHop === 'number'
    && typeof state.createdAt === 'string'
    && typeof state.updatedAt === 'string'
    && ['running', 'awaiting-gate', 'completed', 'aborted', 'failed'].includes(state.status ?? '')
}

export async function findResumableRun(
  slug: string,
  paths: ChoxPaths
): Promise<RunHandle | undefined> {
  const parent = join(paths.runs, slug)
  let entries: string[]
  try {
    entries = await readdir(parent)
  } catch {
    return undefined
  }
  const candidates: Array<{ state: RunState, dir: string }> = []
  for (const entry of entries) {
    const dir = join(parent, entry)
    try {
      const value = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')) as unknown
      if (!isRunState(value)) throw new Error('invalid run-state shape')
      if (value.status === 'running' || value.status === 'awaiting-gate') {
        candidates.push({ state: value, dir })
      }
    } catch (error) {
      process.emitWarning(`Unreadable run state at ${join(dir, 'run.json')}: ${String(error)}`)
    }
  }
  candidates.sort((left, right) => right.state.updatedAt.localeCompare(left.state.updatedAt))
  if (candidates.length > 1) {
    process.emitWarning(
      `Found ${candidates.length} resumable runs for ${slug}; resuming newest ${candidates[0]?.state.runId}.`
    )
  }
  const selected = candidates[0]
  if (!selected) return undefined
  return {
    ...selected,
    events: createEventWriter(join(selected.dir, 'events.jsonl'))
  }
}

export async function snapshotArtifacts(
  handle: RunHandle,
  hop: number,
  worktree: string,
  produces: string[]
): Promise<void> {
  const destination = join(handle.dir, 'artifacts', `hop-${hop}`)
  await mkdir(destination, { recursive: true })
  for (const relativePath of produces) {
    await copyFile(join(worktree, relativePath), join(destination, basename(relativePath)))
  }
}
