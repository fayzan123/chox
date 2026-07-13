import type { AnalysisEngine } from '../engines/engine.js'
import { validateRelay, type Autonomy, type Relay } from './ir.js'
import type { Finding } from '../lenses/lens.js'
import { slugify } from '../slugify.js'

export interface DraftedRelay {
  slug: string
  relay: Relay
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
  return [
    'Draft a runnable relay for this confirmed handoff finding.',
    'Return JSON only: {"slug":string,"hops":[{"runtime":"claude|codex","role":string,"autonomy":"strict|challenge|autonomous","prompt":string}]}.',
    'Plan prompts demand a structured task breakdown and manifest. Implementation prompts demand challenge notes.',
    `Finding: ${JSON.stringify({ chain: finding.chain, evidence: finding.evidence, confirmation: finding.confirmation })}`
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
    parsed = parseDraft(await engine.analyze(draftPrompt(finding), { timeoutMs: 30_000 }))
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
