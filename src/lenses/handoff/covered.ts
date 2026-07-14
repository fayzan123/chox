import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { loadRelay } from '../../artifacts/relay-loader.js'
import type { ChoxPaths } from '../../paths.js'
import type { Candidate } from '../lens.js'

export interface InstalledRelayShape {
  slug: string
  runtimes: string[]
}

export const sourceRuntime: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'codex'
}

async function existingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function relaySlugs(dir: string): Promise<string[]> {
  try {
    return [...new Set(await readdir(dir))].sort()
  } catch {
    return []
  }
}

async function shapesFromDirectory(opts: {
  dir: string
  repoRoot: string
  paths: ChoxPaths
}): Promise<InstalledRelayShape[]> {
  const shapes: InstalledRelayShape[] = []
  for (const slug of await relaySlugs(opts.dir)) {
    try {
      const loaded = await loadRelay(slug, { repoRoot: opts.repoRoot, paths: opts.paths })
      shapes.push({
        slug: loaded.relay.slug,
        runtimes: loaded.relay.hops.map((hop) => hop.runtime)
      })
    } catch {
      // Invalid or incomplete relays are not working installed automation.
    }
  }
  return shapes
}

export async function resolveInstalledRelayShapes(opts: {
  repoRoots: string[]
  paths: ChoxPaths
}): Promise<InstalledRelayShape[]> {
  const shapes: InstalledRelayShape[] = []
  const repoRoots = [...new Set(opts.repoRoots.map((repoRoot) => resolve(repoRoot)))]
  for (const repoRoot of repoRoots) {
    if (!await existingDirectory(repoRoot)) continue
    shapes.push(...await shapesFromDirectory({
      dir: join(repoRoot, '.chox', 'relays'),
      repoRoot,
      paths: opts.paths
    }))
  }
  shapes.push(...await shapesFromDirectory({
    dir: opts.paths.relays,
    // loadRelay requires a repoRoot. Chox home is a deliberately relay-free
    // repo-local stand-in, so resolution falls through to the global directory.
    repoRoot: opts.paths.home,
    paths: opts.paths
  }))
  return shapes
}

export function findCoveringRelay(
  candidate: Candidate,
  shapes: InstalledRelayShape[]
): string | undefined {
  const runtimes = candidate.chain.map((sourceId) => sourceRuntime[sourceId] ?? sourceId)
  return shapes.find((shape) => (
    shape.runtimes.length === runtimes.length
    && shape.runtimes.every((runtime, index) => runtime === runtimes[index])
  ))?.slug
}
