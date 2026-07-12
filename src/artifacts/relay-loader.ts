import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

import { ChoxUsageError } from '../errors.js'
import type { ChoxPaths } from '../paths.js'
import { isValidSlug } from '../slugify.js'
import { validateRelay, type Relay } from './ir.js'

export interface LoadedRelay {
  relay: Relay
  dir: string
  repoRoot: string
  templates: Map<string, string>
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function loadRelay(
  slug: string,
  opts: { repoRoot: string, paths: ChoxPaths }
): Promise<LoadedRelay> {
  if (!isValidSlug(slug)) {
    throw new ChoxUsageError(`Invalid relay slug: ${JSON.stringify(slug)}`)
  }

  const candidates = [
    join(opts.repoRoot, '.chox', 'relays', slug),
    join(opts.paths.relays, slug)
  ]
  let dir: string | undefined
  for (const candidate of candidates) {
    if (await isReadable(join(candidate, 'relay.json'))) {
      dir = candidate
      break
    }
  }
  if (!dir) {
    throw new ChoxUsageError(
      `Relay ${JSON.stringify(slug)} was not found. Searched:\n${candidates.map((path) => `- ${path}`).join('\n')}`
    )
  }

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
  return { relay, dir, repoRoot: opts.repoRoot, templates }
}
