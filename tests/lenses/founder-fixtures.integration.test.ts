import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, expect, test } from 'vitest'

import {
  findCoveringRelay,
  resolveInstalledRelayShapes,
  sourceRuntime
} from '../../src/lenses/handoff/covered.js'
import { scanHandoff } from '../../src/lenses/handoff/scan.js'
import { resolvePaths } from '../../src/paths.js'
import { claudeCodeSource } from '../../src/sources/claude-code.js'
import { codexSource } from '../../src/sources/codex.js'
import type { SessionRef, SessionSource } from '../../src/sources/source.js'
import { openSubstrate } from '../../src/substrate/store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

const fixtureDirs = new Map<SessionSource, string>([
  [claudeCodeSource, fileURLToPath(new URL('../../fixtures/claude-code/', import.meta.url))],
  [codexSource, fileURLToPath(new URL('../../fixtures/codex/', import.meta.url))]
])

async function fixtureRef(source: SessionSource, fileRef: string): Promise<SessionRef> {
  const info = await stat(fileRef)
  return {
    sourceId: source.id,
    fileRef,
    mtime: Math.trunc(info.mtimeMs),
    size: info.size
  }
}

test('the founder-redacted corpus surfaces a cross-agent handoff candidate', async () => {
  const root = await makeTempDir()
  const paths = resolvePaths({ CHOX_HOME: join(root, 'chox-home') })
  const store = openSubstrate(paths)
  for (const [source, dir] of fixtureDirs) {
    store.upsertSource({ id: source.id, kind: source.id, rootPath: dir })
    const files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl')).sort()
    for (const name of files) {
      const ref = await fixtureRef(source, join(dir, name))
      store.replaceSession(source.id, ref.fileRef, await source.parse(ref))
    }
  }

  const candidates = await scanHandoff(store)
  expect(candidates.length).toBeGreaterThanOrEqual(1)
  expect(candidates.some(({ chain, evidence }) => (
    chain.includes('claude-code')
    && chain.includes('codex')
    && (evidence.sessionCount >= 3 || evidence.repos.length >= 2)
  ))).toBe(true)

  const candidate = candidates.find(({ chain }) => (
    chain.includes('claude-code') && chain.includes('codex')
  ))
  expect(candidate).toBeDefined()
  const slug = 'founder-loop'
  const relayDir = join(paths.relays, slug)
  await mkdir(relayDir, { recursive: true })
  const runtimes = candidate!.chain.map((sourceId) => sourceRuntime[sourceId] ?? sourceId)
  const hops = runtimes.map((runtime, index) => ({
    runtime,
    role: `role-${index + 1}`,
    promptTemplate: `hop-${index + 1}.md`,
    autonomy: 'autonomous',
    produces: [`artifact-${index + 1}.md`]
  }))
  await writeFile(join(relayDir, 'relay.json'), JSON.stringify({ slug, hops }))
  await Promise.all(hops.map(async (hop, index) => {
    await writeFile(join(relayDir, hop.promptTemplate), `Prompt ${index + 1}`)
  }))
  const shapes = await resolveInstalledRelayShapes({
    repoRoots: candidate!.evidence.repos,
    paths
  })
  expect(findCoveringRelay(candidate!, shapes)).toBe(slug)
  store.close()
})
