import type { AnalysisEngine } from '../../engines/engine.js'
import { readSessionExcerpt } from '../../sources/source.js'
import type { SubstrateStore } from '../../substrate/store.js'
import type { Candidate, Finding } from '../lens.js'

export interface ConfirmationFailure {
  candidateId: string
  message: string
}

export interface ConfirmationOutcome {
  findings: Finding[]
  failures: ConfirmationFailure[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeCandidate(candidate: Candidate): unknown {
  return {
    pattern: candidate.pattern,
    chain: candidate.chain,
    evidence: {
      occurrenceCount: candidate.evidence.occurrenceCount,
      sessionCount: candidate.evidence.sessionCount,
      dates: candidate.evidence.dates,
      repoCount: candidate.evidence.repos.length,
      totalMinutes: candidate.evidence.totalMinutes,
      medianMinutes: candidate.evidence.medianMinutes
    },
    occurrences: candidate.occurrences.map((occurrence) => ({
      sourceIds: occurrence.sourceIds,
      startedAt: occurrence.startedAt,
      endedAt: occurrence.endedAt,
      durationMinutes: occurrence.durationMinutes,
      weight: occurrence.weight,
      gitCorrelated: occurrence.gitCorrelated,
      continuationPairs: occurrence.continuationPairs
    }))
  }
}

async function highestWeightedExcerpts(candidate: Candidate): Promise<Array<{
  source: string
  excerpt: string
}>> {
  const highest = candidate.occurrences[0]
  if (!highest) return []
  const excerpts: Array<{ source: string, excerpt: string }> = []
  for (let index = 0; index < highest.refs.length; index += 1) {
    const ref = highest.refs[index]
    const source = highest.sourceIds[index]
    if (!ref || !source) continue
    try {
      excerpts.push({ source, excerpt: await readSessionExcerpt(source, ref, 3000) })
    } catch {
      // The source file may have moved since scan. Confirmation can still use metadata.
    }
  }
  return excerpts
}

function confirmationPrompt(candidate: Candidate, excerpts: unknown): string {
  return [
    'You are confirming a locally detected cross-agent workflow.',
    'Judge whether it is a coherent repeated handoff, not mere temporal coincidence.',
    'If confirmed, draft a concise relay with one hop per chain entry.',
    'Each hop needs runtime (claude|codex), role, autonomy, and prompt.',
    'Plan prompts must demand a structured breakdown and manifest; implementation prompts must demand challenge notes.',
    'Return JSON only: {"confirmed":boolean,"reason":string,"relay":{"slug":string,"hops":[...]}}.',
    '',
    `Candidate: ${JSON.stringify(safeCandidate(candidate))}`,
    `Highest-weighted transcript excerpts: ${JSON.stringify(excerpts)}`
  ].join('\n')
}

function findingFromResponse(candidate: Candidate, value: unknown, engineCalls: number): Finding | undefined {
  if (!isRecord(value) || typeof value.confirmed !== 'boolean') {
    throw new Error('engine confirmation response is missing boolean confirmed')
  }
  if (!value.confirmed) return undefined
  if (typeof value.reason !== 'string' || value.reason.trim() === '') {
    throw new Error('engine confirmation response is missing a reason')
  }
  if (!isRecord(value.relay)) {
    throw new Error('engine confirmation response is missing a relay draft')
  }
  return {
    ...candidate,
    kind: 'relay',
    confirmed: true,
    confirmation: value.reason,
    engineCalls,
    draft: value.relay
  }
}

export async function confirmHandoffCandidates(opts: {
  store: SubstrateStore
  candidates: Candidate[]
  engine: AnalysisEngine
  maxCallsPerFinding?: number
}): Promise<ConfirmationOutcome> {
  const findings: Finding[] = []
  const failures: ConfirmationFailure[] = []
  const maxCalls = opts.maxCallsPerFinding ?? 3
  for (const candidate of opts.candidates) {
    const callsBefore = opts.engine.stats().calls
    const started = Date.now()
    try {
      const excerpts = await highestWeightedExcerpts(candidate)
      const response = await opts.engine.analyze(confirmationPrompt(candidate, excerpts), {
        timeoutMs: 30_000
      })
      const calls = opts.engine.stats().calls - callsBefore
      if (calls > maxCalls) throw new Error(`engine call budget exceeded (${calls}/${maxCalls})`)
      if (Date.now() - started >= 90_000) throw new Error('confirmation exceeded the 90s finding budget')
      const finding = findingFromResponse(candidate, response, calls)
      if (!finding) continue
      opts.store.upsertFinding({
        id: finding.id,
        lens: 'handoff',
        kind: 'relay',
        createdAt: new Date().toISOString(),
        status: 'suggested',
        payload: finding
      })
      findings.push(finding)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ candidateId: candidate.id, message })
      opts.store.upsertFinding({
        id: candidate.id,
        lens: 'handoff',
        kind: 'handoff-candidate',
        createdAt: new Date().toISOString(),
        status: 'suggested',
        payload: { ...candidate, confirmationError: message }
      })
    }
  }
  return { findings, failures }
}
