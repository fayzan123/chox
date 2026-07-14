import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ChoxUsageError } from '../errors.js'
import type { ChoxPaths } from '../paths.js'
import { isValidSlug } from '../slugify.js'
import { validateRelay, type Relay } from './ir.js'

export interface LoadedRelay {
  relay: Relay
  dir: string
  repoRoot: string
  templates: Map<string, string>
  source?: RelaySource
}

export type RelaySource = 'repository' | 'global' | 'built-in'

export interface RelaySearchRoot {
  source: RelaySource
  dir: string
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

let packageRootPromise: Promise<string> | undefined

async function packageRoot(): Promise<string> {
  packageRootPromise ??= (async () => {
    let current = dirname(fileURLToPath(import.meta.url))
    while (true) {
      if (await isReadable(join(current, 'package.json'))) return current
      const parent = dirname(current)
      if (parent === current) {
        throw new ChoxUsageError('Chox installation is missing package.json. Reinstall Chox.')
      }
      current = parent
    }
  })()
  return packageRootPromise
}

export async function relaySearchRoots(opts: {
  repoRoot?: string
  paths: ChoxPaths
}): Promise<RelaySearchRoot[]> {
  return [
    ...(opts.repoRoot
      ? [{ source: 'repository' as const, dir: join(opts.repoRoot, '.chox', 'relays') }]
      : []),
    { source: 'global', dir: opts.paths.relays },
    { source: 'built-in', dir: join(await packageRoot(), 'relays') }
  ]
}

export async function loadRelay(
  slug: string,
  opts: { repoRoot?: string, paths: ChoxPaths }
): Promise<LoadedRelay> {
  if (!isValidSlug(slug)) {
    throw new ChoxUsageError(`Invalid relay slug: ${JSON.stringify(slug)}`)
  }

  const roots = await relaySearchRoots(opts)
  const candidates = roots.map(({ source, dir }) => ({ source, dir: join(dir, slug) }))
  let selected: { source: RelaySource, dir: string } | undefined
  for (const candidate of candidates) {
    if (await isReadable(join(candidate.dir, 'relay.json'))) {
      selected = candidate
      break
    }
  }
  if (!selected) {
    throw new ChoxUsageError(
      `Relay ${JSON.stringify(slug)} was not found. Searched:\n${candidates.map(({ dir }) => `- ${dir}`).join('\n')}`
    )
  }
  const { dir, source } = selected

  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(dir, 'relay.json'), 'utf8')) as unknown
  } catch (error) {
    throw new ChoxUsageError(`Could not read relay definition ${join(dir, 'relay.json')}: ${String(error)}`)
  }
  const relay = validateRelay(raw, { slug })
  const templates = new Map<string, string>()
  const missing: string[] = []
  for (const hop of relay.hops) {
    if (templates.has(hop.promptTemplate)) continue
    const templatePath = join(dir, hop.promptTemplate)
    try {
      templates.set(hop.promptTemplate, await readFile(templatePath, 'utf8'))
    } catch {
      missing.push(templatePath)
    }
  }
  if (missing.length > 0) {
    throw new ChoxUsageError(
      `Relay template file${missing.length === 1 ? '' : 's'} missing:\n${missing.map((path) => `- ${path}`).join('\n')}`
    )
  }
  return {
    relay,
    dir,
    repoRoot: opts.repoRoot ?? opts.paths.home,
    templates,
    source
  }
}
