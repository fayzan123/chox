import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { resolvePaths } from '../../src/paths.js'
import {
  createRun,
  findResumableRun,
  saveState,
  snapshotArtifacts
} from '../../src/harness/run-store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

async function createTestRun(root: string, runId: string, updatedAt?: string) {
  const paths = resolvePaths({ CHOX_HOME: join(root, 'home') })
  const handle = await createRun('demo', {
    runId,
    repoRoot: join(root, 'repo'),
    worktreePath: join(root, 'worktree', runId),
    branch: `chox/demo/${runId}`
  }, paths)
  if (updatedAt) await saveState(handle, { updatedAt })
  return { paths, handle }
}

test('run state saves atomically and remains complete JSON', async () => {
  const root = await makeTempDir()
  const { handle } = await createTestRun(root, 'run-1')
  await saveState(handle, { status: 'awaiting-gate', currentHop: 1 })

  const saved = JSON.parse(await readFile(join(handle.dir, 'run.json'), 'utf8')) as {
    status: string
    currentHop: number
  }
  expect(saved).toMatchObject({ status: 'awaiting-gate', currentHop: 1 })
  expect((await readdir(handle.dir)).filter((name) => name.includes('.tmp-'))).toEqual([])
  await handle.events.close()
})

test('the newest resumable run is selected and older candidates are warned about', async () => {
  const root = await makeTempDir()
  const first = await createTestRun(root, 'run-1', '2026-01-01T00:00:00.000Z')
  const second = await createTestRun(root, 'run-2', '2026-01-02T00:00:00.000Z')
  await first.handle.events.close()
  await second.handle.events.close()
  const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)

  const resumed = await findResumableRun('demo', second.paths)
  expect(resumed?.state.runId).toBe('run-2')
  expect(warning).toHaveBeenCalledWith(expect.stringMatching(/2 resumable runs/))
  await resumed?.events.close()
  warning.mockRestore()
})

test('artifact snapshots copy the post-edit version approved at the gate', async () => {
  const root = await makeTempDir()
  const { handle } = await createTestRun(root, 'run-1')
  const worktree = join(root, 'worktree')
  await mkdir(join(worktree, '.chox-run'), { recursive: true })
  await writeFile(join(worktree, '.chox-run', 'spec.md'), 'before edit')
  await writeFile(join(worktree, '.chox-run', 'spec.md'), 'after edit')

  await snapshotArtifacts(handle, 0, worktree, ['.chox-run/spec.md'])
  expect(await readFile(join(handle.dir, 'artifacts', 'hop-0', 'spec.md'), 'utf8')).toBe('after edit')
  await handle.events.close()
})
