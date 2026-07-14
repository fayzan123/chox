import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

import type { ChoxPaths } from '../paths.js'
import { isValidSlug } from '../slugify.js'
import { relayConsumesTask } from './relay-compiler.js'
import {
  loadRelay,
  relaySearchRoots,
  type LoadedRelay,
  type RelaySource
} from './relay-loader.js'

export interface RelayHopInspection {
  index: number
  role: string
  runtime: string
  model: string
  interaction: 'interactive' | 'headless'
  autonomy: 'strict' | 'challenge' | 'autonomous'
  artifacts: string[]
  promptSummary: string
  prompt?: string
}

export interface RelayInspection {
  slug: string
  source: RelaySource | 'finding-draft'
  path: string
  gates: 'all-boundaries' | 'none'
  taskRequired: boolean
  hops: RelayHopInspection[]
}

export interface RelayCatalogEntry extends Omit<RelayInspection, 'source'> {
  source: RelaySource
  shadowedSources: RelaySource[]
}

export interface RelayCatalog {
  relays: RelayCatalogEntry[]
  warnings: string[]
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function slugsAt(dir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const slugs: string[] = []
  for (const name of names) {
    if (isValidSlug(name) && await readable(join(dir, name, 'relay.json'))) slugs.push(name)
  }
  return slugs.sort()
}

export function summarizePrompt(prompt: string): string {
  const first = prompt.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  if (!first) return '(empty prompt)'
  return first.length <= 100 ? first : `${first.slice(0, 97)}…`
}

export function inspectLoadedRelay(
  loaded: LoadedRelay,
  opts: { prompts?: boolean } = {}
): RelayInspection {
  return {
    slug: loaded.relay.slug,
    source: loaded.source ?? 'finding-draft',
    path: loaded.dir,
    gates: loaded.relay.gates,
    taskRequired: relayConsumesTask(loaded),
    hops: loaded.relay.hops.map((hop, index) => {
      const prompt = loaded.templates.get(hop.promptTemplate) ?? ''
      return {
        index,
        role: hop.role,
        runtime: hop.runtime,
        model: hop.model ?? 'CLI default',
        interaction: hop.interaction ?? 'interactive',
        autonomy: hop.autonomy,
        artifacts: [...hop.produces],
        promptSummary: summarizePrompt(prompt),
        ...(opts.prompts ? { prompt } : {})
      }
    })
  }
}

export async function inspectRelay(opts: {
  slug: string
  repoRoot?: string
  paths: ChoxPaths
  prompts?: boolean
}): Promise<RelayInspection> {
  return inspectLoadedRelay(await loadRelay(opts.slug, {
    ...(opts.repoRoot ? { repoRoot: opts.repoRoot } : {}),
    paths: opts.paths
  }), { prompts: opts.prompts ?? false })
}

export async function catalogRelays(opts: {
  repoRoot?: string
  paths: ChoxPaths
}): Promise<RelayCatalog> {
  const roots = await relaySearchRoots(opts)
  const locations = new Map<string, RelaySource[]>()
  for (const root of roots) {
    for (const slug of await slugsAt(root.dir)) {
      const sources = locations.get(slug) ?? []
      sources.push(root.source)
      locations.set(slug, sources)
    }
  }

  const relays: RelayCatalogEntry[] = []
  const warnings: string[] = []
  for (const slug of [...locations.keys()].sort()) {
    try {
      const loaded = await loadRelay(slug, {
        ...(opts.repoRoot ? { repoRoot: opts.repoRoot } : {}),
        paths: opts.paths
      })
      if (!loaded.source) throw new Error(`Relay ${slug} has no resolution source`)
      const inspection = inspectLoadedRelay(loaded)
      relays.push({
        ...inspection,
        source: loaded.source,
        shadowedSources: (locations.get(slug) ?? []).filter((source) => source !== loaded.source)
      })
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { relays, warnings }
}

export function renderRelayList(catalog: RelayCatalog): string {
  if (catalog.relays.length === 0) return 'No relays found.\n'
  const lines = ['Relays:']
  for (const relay of catalog.relays) {
    const sequence = relay.hops.map(({ runtime }) => runtime).join(' → ')
    const shadowing = relay.shadowedSources.length > 0
      ? `; winner ${relay.source}, shadows ${relay.shadowedSources.join(', ')}`
      : ''
    lines.push(
      `${relay.slug} · ${relay.source}${shadowing}`,
      `  ${relay.hops.length} hop(s): ${sequence}; gates ${relay.gates}; task ${relay.taskRequired ? 'required' : 'not required'}`
    )
  }
  return `${lines.join('\n')}\n`
}

export function renderRelayShow(relay: RelayInspection): string {
  const lines = [
    `Relay: ${relay.slug}`,
    `Source: ${relay.source}`,
    `Provenance: ${relay.path}`,
    `Gates: ${relay.gates}`,
    `Task: ${relay.taskRequired ? 'required (--task or --task-file)' : 'not required'}`,
    '',
    'Workflow:'
  ]
  for (const hop of relay.hops) {
    lines.push(
      `${hop.index + 1}. ${hop.role} · ${hop.runtime} · model ${hop.model} · ${hop.interaction} · autonomy ${hop.autonomy}`,
      `   Artifacts: ${hop.artifacts.length > 0 ? hop.artifacts.join(', ') : '(none)'}`,
      `   Prompt: ${hop.promptSummary}`
    )
    if (hop.prompt !== undefined) lines.push('', hop.prompt.trimEnd(), '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
