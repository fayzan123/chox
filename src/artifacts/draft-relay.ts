import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AnalysisEngine } from '../engines/engine.js'
import { validateRelay, type Autonomy, type Relay } from './ir.js'
import type { Finding } from '../lenses/lens.js'
import { slugify } from '../slugify.js'
import type { SubstrateStore } from '../substrate/store.js'

const draftingTimeoutMs = 25_000

export interface DraftedRelay {
  slug: string
  relay: Relay
  relayJson: Record<string, unknown>
  templates: Record<string, string>
}

export interface PersistedDraftedRelay {
  slug: string
  relayJson: Record<string, unknown>
  templates: Record<string, string>
}

interface DraftHop {
  runtime: 'claude' | 'codex'
  role: string
  autonomy: Autonomy
  prompt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFilename(value: string): boolean {
  return value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0')
}

function parseDraft(value: unknown): { slug: string, hops: DraftHop[] } {
  if (!isRecord(value)) throw new Error('relay draft must be an object')
  const slug = typeof value.slug === 'string' ? slugify(value.slug) : ''
  if (!slug) throw new Error('relay draft needs a valid slug')
  if (!Array.isArray(value.hops) || value.hops.length === 0) {
    throw new Error('relay draft needs at least one hop')
  }
  const hops: DraftHop[] = value.hops.map((item, index) => {
    if (!isRecord(item)) throw new Error(`relay draft hop ${index + 1} must be an object`)
    const runtime = item.runtime
    const role = item.role
    const autonomy = item.autonomy
    const prompt = item.prompt
    if (runtime !== 'claude' && runtime !== 'codex') {
      throw new Error(`relay draft hop ${index + 1} has an unsupported runtime`)
    }
    if (typeof role !== 'string' || role.trim() === '') {
      throw new Error(`relay draft hop ${index + 1} needs a role`)
    }
    if (autonomy !== 'strict' && autonomy !== 'challenge' && autonomy !== 'autonomous') {
      throw new Error(`relay draft hop ${index + 1} needs a valid autonomy level`)
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error(`relay draft hop ${index + 1} needs a prompt`)
    }
    return { runtime, role: role.trim(), autonomy, prompt: prompt.trim() }
  })
  return { slug, hops }
}

function producedFor(role: string, index: number): string[] {
  const normalized = role.toLocaleLowerCase('en-US')
  if (normalized.includes('plan') || normalized.includes('spec')) return ['spec.md', 'manifest.json']
  if (normalized.includes('implement') || normalized.includes('build')) return ['challenge-notes.md']
  if (normalized.includes('review')) return ['review.md']
  return [`handoff-${index + 1}.md`]
}

function templateContract(hop: DraftHop): string {
  const lines = [hop.prompt, '', '## Chox output contract']
  const role = hop.role.toLocaleLowerCase('en-US')
  if (role.includes('plan') || role.includes('spec')) {
    lines.push(
      '- Write a structured task breakdown to .chox-run/spec.md.',
      '- Write manifest.json with files.create/modify/delete and commands before implementation begins.'
    )
  }
  if (role.includes('implement') || role.includes('build')) {
    lines.push(
      '- Implement against the prior spec and manifest.',
      '- Record every intentional departure and its rationale in .chox-run/challenge-notes.md.'
    )
  }
  if (role.includes('review')) {
    lines.push('- Review the implementation against the persisted spec, manifest, and challenge notes.')
  }
  lines.push(`- Produce: {{produces}}`)
  return `${lines.join('\n')}\n`
}

function draftPrompt(finding: Finding): string {
  const evidence = {
    occurrenceCount: finding.evidence.occurrenceCount,
    sessionCount: finding.evidence.sessionCount,
    dates: finding.evidence.dates,
    repoCount: finding.evidence.repos.length,
    totalMinutes: finding.evidence.totalMinutes,
    medianMinutes: finding.evidence.medianMinutes
  }
  return [
    'Draft a runnable relay for this confirmed handoff finding.',
    'Return JSON only: {"slug":string,"hops":[{"runtime":"claude|codex","role":string,"autonomy":"strict|challenge|autonomous","prompt":string}]}.',
    'Plan prompts demand a structured task breakdown and manifest. Implementation prompts demand challenge notes.',
    `Finding: ${JSON.stringify({ chain: finding.chain, evidence, confirmation: finding.confirmation })}`
  ].join('\n')
}

export async function draftRelay(
  finding: Finding,
  engine: AnalysisEngine
): Promise<DraftedRelay> {
  const before = engine.stats().calls
  let parsed: { slug: string, hops: DraftHop[] }
  try {
    parsed = parseDraft(finding.draft)
  } catch {
    if (finding.engineCalls >= 3) {
      throw new Error(`relay drafting exceeded the engine call budget (${finding.engineCalls}/3)`)
    }
    parsed = parseDraft(await engine.analyze(draftPrompt(finding), { timeoutMs: draftingTimeoutMs }))
  }
  const calls = engine.stats().calls - before
  const findingCalls = finding.engineCalls + calls
  if (calls > 2 || findingCalls > 3) {
    throw new Error(`relay drafting exceeded the engine call budget (${findingCalls}/3)`)
  }

  const templates: Record<string, string> = {}
  const usedNames = new Set<string>()
  const relayRaw = {
    slug: parsed.slug,
    gates: 'all-boundaries' as const,
    hops: parsed.hops.map((hop, index) => {
      const base = slugify(hop.role) || `hop-${index + 1}`
      let filename = `${base}.md`
      let suffix = 2
      while (usedNames.has(filename)) {
        filename = `${base}-${suffix}.md`
        suffix += 1
      }
      usedNames.add(filename)
      templates[filename] = templateContract(hop)
      return {
        runtime: hop.runtime,
        role: hop.role,
        autonomy: hop.autonomy,
        promptTemplate: filename,
        produces: producedFor(hop.role, index)
      }
    })
  }
  const relay = validateRelay(relayRaw, { slug: parsed.slug })
  return {
    slug: parsed.slug,
    relay,
    relayJson: relayRaw,
    templates
  }
}

export function parseFinding(value: unknown): Finding {
  if (!isRecord(value)) throw new Error('finding payload is not an object')
  if (
    typeof value.id !== 'string'
    || value.lens !== 'handoff'
    || value.kind !== 'relay'
    || value.confirmed !== true
    || typeof value.confirmation !== 'string'
    || typeof value.engineCalls !== 'number'
    || !Array.isArray(value.chain)
    || !Array.isArray(value.occurrences)
    || !isRecord(value.evidence)
  ) throw new Error('finding payload is not a confirmed relay finding')
  return value as unknown as Finding
}

export function persistedDraft(value: unknown): PersistedDraftedRelay {
  if (!isRecord(value) || typeof value.slug !== 'string' || !isRecord(value.relayJson)) {
    throw new Error('finding has no installable relay draft')
  }
  if (!isRecord(value.templates)) throw new Error('finding relay templates are invalid')
  const templates: Record<string, string> = {}
  for (const [name, content] of Object.entries(value.templates)) {
    if (!isFilename(name)) throw new Error(`finding relay template ${name} must be a filename`)
    if (typeof content !== 'string') throw new Error(`finding relay template ${name} is invalid`)
    templates[name] = content
  }
  const relay = validateRelay(value.relayJson, { slug: value.slug })
  for (const hop of relay.hops) {
    if (templates[hop.promptTemplate] === undefined) {
      throw new Error(`finding relay template ${hop.promptTemplate} is missing`)
    }
  }
  return { slug: value.slug, relayJson: value.relayJson, templates }
}

async function availableSlug(baseDir: string, requested: string): Promise<string> {
  let suffix = 1
  while (true) {
    const slug = suffix === 1 ? requested : `${requested}-${suffix}`
    try {
      await access(join(baseDir, slug))
      suffix += 1
    } catch {
      return slug
    }
  }
}

export async function installDraftedRelay(opts: {
  store: SubstrateStore
  findingId: string
  draft: PersistedDraftedRelay
  baseDir: string
  version: string
  now?: () => Date
}): Promise<{ slug: string, dir: string, paths: string[] }> {
  await mkdir(opts.baseDir, { recursive: true })
  const slug = await availableSlug(opts.baseDir, opts.draft.slug)
  const dir = join(opts.baseDir, slug)
  await mkdir(dir)
  const generatedBy = `chox@${opts.version}`
  const relayPath = join(dir, 'relay.json')
  const relayJson = {
    ...opts.draft.relayJson,
    slug,
    generatedBy,
    finding: opts.findingId
  }
  await writeFile(relayPath, `${JSON.stringify(relayJson, null, 2)}\n`)
  const paths = [relayPath]
  for (const [name, content] of Object.entries(opts.draft.templates)) {
    const path = join(dir, name)
    await writeFile(
      path,
      `<!-- generatedBy: ${generatedBy}, finding: ${opts.findingId} -->\n${content}`
    )
    paths.push(path)
  }
  const createdAt = (opts.now ?? (() => new Date()))().toISOString()
  opts.store.insertArtifact({
    id: `artifact-${createHash('sha256').update(`${opts.findingId}:${dir}`).digest('hex').slice(0, 20)}`,
    findingId: opts.findingId,
    kind: 'relay',
    slug,
    placedPaths: paths,
    createdAt
  })
  opts.store.updateFindingStatus(opts.findingId, 'exported')
  return { slug, dir, paths }
}
