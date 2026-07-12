import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import type { CompiledHop } from '../src/artifacts/relay-compiler.js'
import {
  checkAutonomy,
  snapshotFootprint,
  type StrictManifest
} from '../src/harness/autonomy.js'
import { createEventWriter, readEvents } from '../src/harness/run-events.js'
import { cleanupTempDirs, makeTempDir } from './helpers/temp.js'
import { git, initGitRepo } from './helpers/git.js'

afterEach(cleanupTempDirs)

function hop(overrides: Partial<CompiledHop> = {}): CompiledHop {
  return {
    index: 0,
    runtime: 'codex',
    role: 'implement',
    autonomy: 'strict',
    prompt: 'implement',
    produces: [],
    gated: true,
    ...overrides
  }
}

async function setupRepo(): Promise<{ root: string, repo: string }> {
  const root = await makeTempDir()
  const repo = await initGitRepo(root)
  await mkdir(join(repo, 'src'))
  await writeFile(join(repo, 'src', 'modify.ts'), 'before\n')
  await writeFile(join(repo, 'src', 'delete.ts'), 'delete me\n')
  await writeFile(join(repo, 'src', 'extra-delete.ts'), 'delete me too\n')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-m', 'sources')
  return { root, repo }
}

async function writer(root: string) {
  return createEventWriter(join(root, 'events.jsonl'))
}

test('strict autonomy distinguishes allowed and out-of-manifest create, modify, and delete', async () => {
  const { root, repo } = await setupRepo()
  const before = await snapshotFootprint(repo)
  await writeFile(join(repo, 'src', 'created.ts'), 'allowed\n')
  await writeFile(join(repo, 'src', 'extra-created.ts'), 'extra\n')
  await writeFile(join(repo, 'src', 'modify.ts'), 'allowed change\n')
  await writeFile(join(repo, 'README.md'), 'extra change\n')
  await rm(join(repo, 'src', 'delete.ts'))
  await rm(join(repo, 'src', 'extra-delete.ts'))
  const events = await writer(root)
  const manifest: StrictManifest = {
    files: {
      create: ['src/created.ts'],
      modify: ['src/modify.ts'],
      delete: ['src/delete.ts']
    },
    commands: []
  }

  const result = await checkAutonomy({ hop: hop(), worktree: repo, before, manifest, events })
  expect(result.blocking).toBe(true)
  const details = result.deviations.map(({ detail }) => detail).join('\n')
  expect(details).toContain('extra-created.ts')
  expect(details).toContain('README.md')
  expect(details).toContain('extra-delete.ts')
  expect(result.deviations).toHaveLength(3)
  await events.close()
})

test('.chox-run is excluded from the implementation footprint', async () => {
  const { root, repo } = await setupRepo()
  const before = await snapshotFootprint(repo)
  await mkdir(join(repo, '.chox-run'))
  await writeFile(join(repo, '.chox-run', 'spec.md'), 'artifact')
  const events = await writer(root)
  const result = await checkAutonomy({
    hop: hop(),
    worktree: repo,
    before,
    manifest: { files: { create: [], modify: [], delete: [] }, commands: [] },
    events
  })
  expect(result.deviations).toEqual([])
  await events.close()
})

test('strict commands accept exact and prefix matches and flag only unknown commands as advisory', async () => {
  const { root, repo } = await setupRepo()
  const before = await snapshotFootprint(repo)
  const events = await writer(root)
  for (const command of ['npm test', 'npm run build -- --mode=test', 'node surprise.js']) {
    events.append('agent:event', { hop: 0, event: { kind: 'command', command } })
  }
  const result = await checkAutonomy({
    hop: hop(),
    worktree: repo,
    before,
    manifest: {
      files: { create: [], modify: [], delete: [] },
      commands: ['npm test', 'npm run build']
    },
    events
  })
  expect(result.deviations).toEqual([expect.objectContaining({
    kind: 'unlisted-command',
    advisory: true,
    detail: expect.stringContaining('node surprise.js')
  })])
  expect(result.blocking).toBe(false)
  await events.close()
})

test('strict without a manifest visibly degrades to challenge semantics', async () => {
  const { root, repo } = await setupRepo()
  await mkdir(join(repo, '.chox-run'))
  await writeFile(join(repo, '.chox-run', 'challenge-notes.md'), 'No deviations.\n')
  const before = await snapshotFootprint(repo)
  const events = await writer(root)
  const result = await checkAutonomy({ hop: hop(), worktree: repo, before, events })
  expect(result.degradedToChallenge).toBe(true)
  expect(result.blocking).toBe(false)
  await events.close()
})

test.each(['', '  \n\t'])('challenge notes containing %j count as missing', async (contents) => {
  const { root, repo } = await setupRepo()
  await mkdir(join(repo, '.chox-run'))
  await writeFile(join(repo, '.chox-run', 'challenge-notes.md'), contents)
  const before = await snapshotFootprint(repo)
  const events = await writer(root)
  const result = await checkAutonomy({
    hop: hop({ autonomy: 'challenge', produces: ['.chox-run/challenge-notes.md'] }),
    worktree: repo,
    before,
    events
  })
  expect(result.blocking).toBe(true)
  expect(result.deviations).toContainEqual(expect.objectContaining({ kind: 'missing-challenge-notes' }))
  await events.close()
})

test('autonomous hops event deviations without blocking', async () => {
  const { root, repo } = await setupRepo()
  const eventPath = join(root, 'events.jsonl')
  const events = createEventWriter(eventPath)
  const before = await snapshotFootprint(repo)
  const result = await checkAutonomy({
    hop: hop({ autonomy: 'autonomous', produces: ['.chox-run/missing.md'] }),
    worktree: repo,
    before,
    events
  })
  expect(result.blocking).toBe(false)
  expect(result.deviations).toContainEqual(expect.objectContaining({ kind: 'missing-artifact' }))
  await events.close()
  const persisted = []
  for await (const event of readEvents(eventPath)) persisted.push(event)
  expect(persisted).toContainEqual(expect.objectContaining({ type: 'deviation' }))
})

test('manifest paths with Windows separators match normalized Git paths', async () => {
  const { root, repo } = await setupRepo()
  const before = await snapshotFootprint(repo)
  await writeFile(join(repo, 'src', 'modify.ts'), 'changed\n')
  const events = await writer(root)
  const result = await checkAutonomy({
    hop: hop(),
    worktree: repo,
    before,
    manifest: {
      files: { create: [], modify: ['src\\modify.ts'], delete: [] },
      commands: []
    },
    events
  })
  expect(result.deviations).toEqual([])
  await events.close()
})
