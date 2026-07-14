import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import {
  findCoveringRelay,
  resolveInstalledRelayShapes
} from '../../src/lenses/handoff/covered.js'
import type { Candidate } from '../../src/lenses/lens.js'
import { resolvePaths } from '../../src/paths.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

async function writeRelay(
  dir: string,
  slug: string,
  runtimes: Array<'claude' | 'codex'>,
  opts: { omitLastTemplate?: boolean } = {}
): Promise<void> {
  await mkdir(dir, { recursive: true })
  const hops = runtimes.map((runtime, index) => ({
    runtime,
    role: `role-${index + 1}`,
    promptTemplate: `hop-${index + 1}.md`,
    autonomy: 'autonomous',
    produces: [`artifact-${index + 1}.md`]
  }))
  await writeFile(join(dir, 'relay.json'), JSON.stringify({ slug, hops }))
  const templates = opts.omitLastTemplate ? runtimes.slice(0, -1) : runtimes
  await Promise.all(templates.map(async (_runtime, index) => {
    await writeFile(join(dir, `hop-${index + 1}.md`), `Prompt ${index + 1}`)
  }))
}

function candidate(chain: string[]): Candidate {
  return {
    id: 'handoff-test',
    lens: 'handoff',
    pattern: chain.join('>'),
    chain,
    surfaced: true,
    occurrences: [],
    evidence: {
      occurrenceCount: 1,
      sessionCount: chain.length,
      dates: ['2026-01-01'],
      repos: ['/repo'],
      totalMinutes: 30,
      medianMinutes: 30
    }
  }
}

test('resolves valid global relay shapes through the canonical loader', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  await writeRelay(
    join(paths.relays, 'spec-implement-review'),
    'spec-implement-review',
    ['claude', 'codex', 'claude']
  )

  await expect(resolveInstalledRelayShapes({ repoRoots: [], paths })).resolves.toEqual([{
    slug: 'spec-implement-review',
    runtimes: ['claude', 'codex', 'claude']
  }])
})

test('orders repo-local relays before global relays', async () => {
  const root = await makeTempDir()
  const repoRoot = join(root, 'repo')
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  await mkdir(repoRoot)
  await writeRelay(
    join(repoRoot, '.chox', 'relays', 'loop-x'),
    'loop-x',
    ['claude', 'codex']
  )
  await writeRelay(
    join(paths.relays, 'global-loop'),
    'global-loop',
    ['codex', 'claude']
  )

  const shapes = await resolveInstalledRelayShapes({ repoRoots: [repoRoot, repoRoot], paths })
  expect(shapes.map(({ slug }) => slug)).toEqual(['loop-x', 'global-loop'])
})

test('skips broken relays while retaining valid installed automation', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  await writeRelay(join(paths.relays, 'broken'), 'broken', ['claude', 'codex'], {
    omitLastTemplate: true
  })
  await writeRelay(join(paths.relays, 'valid'), 'valid', ['codex', 'claude'])

  await expect(resolveInstalledRelayShapes({ repoRoots: [join(root, 'missing')], paths }))
    .resolves.toEqual([{ slug: 'valid', runtimes: ['codex', 'claude'] }])
})

test('matches exact ordered runtime shapes and maps Claude Code source ids', () => {
  const shapes = [{
    slug: 'spec-implement-review',
    runtimes: ['claude', 'codex', 'claude']
  }]
  expect(findCoveringRelay(candidate(['claude-code', 'codex', 'claude-code']), shapes))
    .toBe('spec-implement-review')
  expect(findCoveringRelay(candidate(['claude-code', 'codex']), shapes)).toBeUndefined()
  expect(findCoveringRelay(candidate(['codex', 'claude-code', 'codex']), shapes)).toBeUndefined()
})
