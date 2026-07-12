import { ChoxUsageError } from '../errors.js'
import { isValidSlug } from '../slugify.js'

export type Autonomy = 'strict' | 'challenge' | 'autonomous'

export interface Relay {
  slug: string
  repo?: string
  hops: RelayHop[]
  gates: 'all-boundaries' | 'none'
}

export interface RelayHop {
  runtime: string
  role: string
  promptTemplate: string
  autonomy: Autonomy
  produces: string[]
  skillRef?: string
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

export function validateRelay(raw: unknown, ctx: { slug: string }): Relay {
  const problems: string[] = []
  if (!isValidSlug(ctx.slug)) {
    problems.push(`relay directory name is not a valid slug: ${JSON.stringify(ctx.slug)}`)
  }
  if (!isRecord(raw)) {
    throw new ChoxUsageError('Invalid relay:\n- relay.json must contain a JSON object')
  }

  const slug = typeof raw.slug === 'string' ? raw.slug : ''
  if (!isValidSlug(slug)) {
    problems.push('slug must contain only lowercase letters, digits, and single hyphens')
  }
  if (slug !== ctx.slug) {
    problems.push(`slug ${JSON.stringify(slug)} must match directory ${JSON.stringify(ctx.slug)}`)
  }
  if (raw.repo !== undefined && typeof raw.repo !== 'string') {
    problems.push('repo must be a string when present')
  }

  const gates = raw.gates === undefined ? 'all-boundaries' : raw.gates
  if (gates !== 'all-boundaries' && gates !== 'none') {
    problems.push("gates must be 'all-boundaries' or 'none'")
  }

  const rawHops = Array.isArray(raw.hops) ? raw.hops : []
  if (!Array.isArray(raw.hops) || rawHops.length === 0) {
    problems.push('hops must be a non-empty array')
  }

  const hops: RelayHop[] = []
  for (const [index, value] of rawHops.entries()) {
    const label = `hop ${index}`
    if (!isRecord(value)) {
      problems.push(`${label} must be an object`)
      continue
    }

    const runtime = typeof value.runtime === 'string' ? value.runtime : ''
    const role = typeof value.role === 'string' ? value.role : ''
    const promptTemplate = typeof value.promptTemplate === 'string' ? value.promptTemplate : ''
    const autonomy = value.autonomy
    const produces = Array.isArray(value.produces)
      ? value.produces.filter((item): item is string => typeof item === 'string')
      : []

    if (runtime !== 'claude' && runtime !== 'codex') {
      problems.push(`${label} runtime must be 'claude' or 'codex'`)
    }
    if (role.trim() === '') {
      problems.push(`${label} role must be a non-empty string`)
    }
    if (!isFilename(promptTemplate)) {
      problems.push(`${label} promptTemplate must be a filename within the relay directory`)
    }
    if (autonomy !== 'strict' && autonomy !== 'challenge' && autonomy !== 'autonomous') {
      problems.push(`${label} autonomy must be 'strict', 'challenge', or 'autonomous'`)
    }
    if (!Array.isArray(value.produces)) {
      problems.push(`${label} produces must be an array of artifact filenames`)
    } else {
      for (const [artifactIndex, artifact] of value.produces.entries()) {
        if (typeof artifact !== 'string' || !isFilename(artifact)) {
          problems.push(`${label} produces[${artifactIndex}] must be an artifact filename`)
        }
      }
      if (new Set(produces).size !== produces.length) {
        problems.push(`${label} produces contains duplicate artifact filenames`)
      }
    }
    if ('skillRef' in value) {
      problems.push(`${label} skillRef is not supported until relay composition ships`)
    }

    hops.push({
      runtime,
      role,
      promptTemplate,
      autonomy: autonomy as Autonomy,
      produces,
      ...('skillRef' in value ? { skillRef: String(value.skillRef) } : {})
    })
  }

  if (problems.length > 0) {
    throw new ChoxUsageError(`Invalid relay:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
  }

  return {
    slug,
    ...(typeof raw.repo === 'string' ? { repo: raw.repo } : {}),
    hops,
    gates: gates as Relay['gates']
  }
}

