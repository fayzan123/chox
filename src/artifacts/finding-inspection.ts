import type { ChoxPaths } from '../paths.js'
import type { StoredFinding } from '../substrate/store.js'
import { ChoxUsageError } from '../errors.js'
import { validateRelay } from './ir.js'
import { persistedDraft } from './draft-relay.js'
import {
  inspectLoadedRelay,
  inspectRelay,
  summarizePrompt,
  type RelayInspection
} from './relay-catalog.js'

export type FindingInspectionState =
  | 'suggested'
  | 'covered'
  | 'subsumed'
  | 'dismissed'
  | 'installed'

export interface FindingEvidenceInspection {
  occurrenceCount: number
  sessionCount: number
  dates: string[]
  repos: string[]
  totalMinutes: number
  medianMinutes: number
}

export interface FindingAnalysisInspection {
  engine: string
  model: string
  callCeiling: number
  calls: number
  usage: Record<string, number>
}

export interface FindingInspection {
  schemaVersion: 1
  id: string
  status: StoredFinding['status']
  state: FindingInspectionState
  lens: string
  kind: string
  chain: string[]
  evidence: FindingEvidenceInspection
  analysis: FindingAnalysisInspection
  workflow: RelayInspection | null
  coveredBy?: string
  subsumedBy?: string
  confirmation?: string
  workflowProblem?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ChoxUsageError(`Finding payload has invalid ${field}`)
  }
  return value
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ChoxUsageError(`Finding payload has invalid ${field}`)
  }
  return value
}

function evidenceFrom(payload: Record<string, unknown>): FindingEvidenceInspection {
  const evidence = record(payload.evidence)
  if (!evidence) throw new ChoxUsageError('Finding payload has no valid evidence object')
  return {
    occurrenceCount: finiteNumber(evidence.occurrenceCount, 'evidence.occurrenceCount'),
    sessionCount: finiteNumber(evidence.sessionCount, 'evidence.sessionCount'),
    dates: strings(evidence.dates, 'evidence.dates'),
    repos: strings(evidence.repos, 'evidence.repos'),
    totalMinutes: finiteNumber(evidence.totalMinutes, 'evidence.totalMinutes'),
    medianMinutes: finiteNumber(evidence.medianMinutes, 'evidence.medianMinutes')
  }
}

function inspectionState(stored: StoredFinding, payload: Record<string, unknown>): FindingInspectionState {
  if (stored.status === 'dismissed') return 'dismissed'
  if (stored.status === 'exported') return 'installed'
  if (typeof payload.coveredBy === 'string') return 'covered'
  if (typeof payload.subsumedBy === 'string') return 'subsumed'
  return 'suggested'
}

function analysisFrom(
  payload: Record<string, unknown>,
  state: FindingInspectionState
): FindingAnalysisInspection {
  const metadata = record(payload.inspection)
  const usageValue = record(metadata?.usage)
  const usage: Record<string, number> = {}
  if (usageValue) {
    for (const [key, value] of Object.entries(usageValue)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) usage[key] = value
    }
  }
  const calls = typeof metadata?.calls === 'number'
    ? finiteNumber(metadata.calls, 'inspection.calls')
    : typeof payload.engineCalls === 'number'
      ? finiteNumber(payload.engineCalls, 'engineCalls')
      : 0
  const engineUsed = calls > 0 || payload.confirmed === true
  return {
    engine: typeof metadata?.engine === 'string'
      ? metadata.engine
      : engineUsed ? 'not recorded' : 'not used',
    model: typeof metadata?.model === 'string'
      ? metadata.model
      : engineUsed ? 'not recorded' : 'n/a',
    callCeiling: typeof metadata?.callCeiling === 'number'
      ? finiteNumber(metadata.callCeiling, 'inspection.callCeiling')
      : 3,
    calls,
    usage
  }
}

function workflowFromDraft(
  findingId: string,
  value: unknown,
  repoRoot: string | undefined,
  prompts: boolean
): RelayInspection {
  const draft = persistedDraft(value)
  const relay = validateRelay(draft.relayJson, { slug: draft.slug })
  return inspectLoadedRelay({
    relay,
    dir: `finding:${findingId}`,
    repoRoot: repoRoot ?? '',
    templates: new Map(Object.entries(draft.templates))
  }, { prompts })
}

function workflowFromEngineDraft(value: unknown, prompts: boolean): RelayInspection | undefined {
  const draft = record(value)
  if (!draft || typeof draft.slug !== 'string' || !Array.isArray(draft.hops)) return undefined
  const hops: RelayInspection['hops'] = []
  let taskRequired = false
  for (const [index, raw] of draft.hops.entries()) {
    const hop = record(raw)
    if (
      !hop
      || typeof hop.runtime !== 'string'
      || typeof hop.role !== 'string'
      || typeof hop.prompt !== 'string'
      || (hop.autonomy !== 'strict' && hop.autonomy !== 'challenge' && hop.autonomy !== 'autonomous')
    ) return undefined
    if (hop.prompt.includes('{{task}}')) taskRequired = true
    hops.push({
      index,
      role: hop.role,
      runtime: hop.runtime,
      model: 'CLI default',
      interaction: 'interactive',
      autonomy: hop.autonomy,
      artifacts: [],
      promptSummary: summarizePrompt(hop.prompt),
      ...(prompts ? { prompt: hop.prompt } : {})
    })
  }
  return {
    slug: draft.slug,
    source: 'finding-draft',
    path: 'engine proposal (not installed)',
    gates: 'all-boundaries',
    taskRequired,
    hops
  }
}

export async function inspectFinding(opts: {
  stored: StoredFinding
  repoRoot?: string
  paths: ChoxPaths
  prompts?: boolean
}): Promise<FindingInspection> {
  const payload = record(opts.stored.payload)
  if (!payload) throw new ChoxUsageError(`Finding ${opts.stored.id} has an invalid payload`)
  const chain = strings(payload.chain, 'chain')
  const state = inspectionState(opts.stored, payload)
  let workflow: RelayInspection | null = null
  let workflowProblem: string | undefined
  try {
    if (payload.draftedRelay !== undefined) {
      workflow = workflowFromDraft(
        opts.stored.id,
        payload.draftedRelay,
        opts.repoRoot,
        opts.prompts ?? false
      )
    } else if (typeof payload.coveredBy === 'string') {
      workflow = await inspectRelay({
        slug: payload.coveredBy,
        ...(opts.repoRoot ? { repoRoot: opts.repoRoot } : {}),
        paths: opts.paths,
        prompts: opts.prompts ?? false
      })
    } else {
      workflow = workflowFromEngineDraft(payload.draft, opts.prompts ?? false) ?? null
    }
  } catch (error) {
    workflowProblem = error instanceof Error ? error.message : String(error)
  }

  return {
    schemaVersion: 1,
    id: opts.stored.id,
    status: opts.stored.status,
    state,
    lens: opts.stored.lens,
    kind: opts.stored.kind,
    chain,
    evidence: evidenceFrom(payload),
    analysis: analysisFrom(payload, state),
    workflow,
    ...(typeof payload.coveredBy === 'string' ? { coveredBy: payload.coveredBy } : {}),
    ...(typeof payload.subsumedBy === 'string' ? { subsumedBy: payload.subsumedBy } : {}),
    ...(typeof payload.confirmation === 'string' ? { confirmation: payload.confirmation } : {}),
    ...(workflowProblem ? { workflowProblem } : {})
  }
}

function usageText(usage: Record<string, number>): string {
  const fields = Object.entries(usage).map(([key, value]) => `${key} ${value}`)
  return fields.length > 0 ? fields.join(', ') : 'not reported'
}

export function renderFinding(inspection: FindingInspection): string {
  const { evidence, analysis } = inspection
  const lines = [
    `Finding: ${inspection.id}`,
    `State: ${inspection.state} (stored status: ${inspection.status})`,
    `Pattern: ${inspection.chain.join(' → ')}`,
    '',
    'Evidence:',
    `  ${evidence.occurrenceCount} occurrence(s), ${evidence.sessionCount} session(s), ${evidence.repos.length} repo(s)`,
    `  Dates: ${evidence.dates.length > 0 ? evidence.dates.join(', ') : '(none)'}`,
    `  Repositories: ${evidence.repos.length > 0 ? evidence.repos.join(', ') : '(none)'}`,
    `  Time: ${evidence.totalMinutes} total minutes; ${evidence.medianMinutes} median minutes`,
    '',
    'Analysis:',
    `  Engine: ${analysis.engine}`,
    `  Model: ${analysis.model}`,
    `  Call ceiling: ${analysis.callCeiling}`,
    `  Actual spend: ${analysis.calls} call(s); tokens ${usageText(analysis.usage)}`
  ]
  if (inspection.confirmation) lines.push(`  Confirmation: ${inspection.confirmation}`)
  if (inspection.coveredBy) lines.push('', `Covered by: ${inspection.coveredBy}`)
  if (inspection.subsumedBy) lines.push('', `Subsumed by: ${inspection.subsumedBy}`)
  if (inspection.workflow) {
    lines.push('', 'Proposed workflow:')
    for (const hop of inspection.workflow.hops) {
      lines.push(
        `  ${hop.index + 1}. ${hop.role} · ${hop.runtime} · model ${hop.model} · autonomy ${hop.autonomy} · ${hop.interaction}`,
        `     Gates: ${inspection.workflow.gates}; artifacts: ${hop.artifacts.length > 0 ? hop.artifacts.join(', ') : '(not assigned)'}`,
        `     Prompt: ${hop.promptSummary}`
      )
      if (hop.prompt !== undefined) lines.push('', hop.prompt.trimEnd(), '')
    }
  } else {
    lines.push('', 'Proposed workflow: not available for this finding state.')
  }
  if (inspection.workflowProblem) lines.push(`Workflow warning: ${inspection.workflowProblem}`)
  return `${lines.join('\n').trimEnd()}\n`
}
