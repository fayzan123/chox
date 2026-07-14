import type { AnalysisEngine } from '../../engines/engine.js'
import { readSessionExcerpt } from '../../sources/source.js'
import type { SubstrateStore } from '../../substrate/store.js'
import type { Candidate, Finding } from '../lens.js'

const confirmationTimeoutMs = 60_000
const confirmationJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    reason: { type: 'string' },
    relay: {
      anyOf: [
        {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            hops: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  runtime: { type: 'string', enum: ['claude', 'codex'] },
                  role: { type: 'string' },
                  autonomy: { type: 'string', enum: ['strict', 'challenge', 'autonomous'] },
                  prompt: { type: 'string' }
                },
                required: ['runtime', 'role', 'autonomy', 'prompt'],
                additionalProperties: false
              }
            }
          },
          required: ['slug', 'hops'],
          additionalProperties: false
        },
        { type: 'null' }
      ]
    }
  },
  required: ['confirmed', 'reason', 'relay'],
  additionalProperties: false
}

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
      sessions: occurrence.sessions,
      interleaved: occurrence.interleaved,
      startedAt: occurrence.startedAt,
      endedAt: occurrence.endedAt,
      durationMinutes: occurrence.durationMinutes,
      weight: occurrence.weight,
      gitCorrelated: occurrence.gitCorrelated,
      continuationPairs: occurrence.continuationPairs
    }))
  }
}

const excerptCharsPerSession = 3000

async function topOccurrenceExcerpts(candidate: Candidate): Promise<Array<{
  occurrence: number
  startedAt: string
  source: string
  excerpt: string
}>> {
  const totalBudget = excerptCharsPerSession * candidate.chain.length
  const top = candidate.occurrences.slice(0, Math.min(3, candidate.occurrences.length))
  if (top.length === 0) return []
  const perOccurrence = Math.floor(totalBudget / top.length)
  const excerpts: Array<{
    occurrence: number
    startedAt: string
    source: string
    excerpt: string
  }> = []
  for (const [rank, occurrence] of top.entries()) {
    const perRef = Math.floor(perOccurrence / Math.max(1, occurrence.refs.length))
    if (perRef <= 0) continue
    for (let index = 0; index < occurrence.refs.length; index += 1) {
      const ref = occurrence.refs[index]
      const source = occurrence.sourceIds[index]
      if (!ref || !source) continue
      try {
        excerpts.push({
          occurrence: rank + 1,
          startedAt: occurrence.startedAt,
          source,
          excerpt: await readSessionExcerpt(source, ref, perRef)
        })
      } catch {
        // The source file may have moved since scan. Confirmation can still use metadata.
      }
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
    'If the candidate is not confirmed, set relay to null.',
    'Return JSON only: {"confirmed":boolean,"reason":string,"relay":{"slug":string,"hops":[...]}}.',
    'Occurrence session start/end times are included. Sessions in an occurrence marked',
    'interleaved:true ran concurrently (their time ranges overlap) — do not present them as a strict sequence and do not invent sequential roles for concurrent sessions.',
    '',
    `Candidate: ${JSON.stringify(safeCandidate(candidate))}`,
    `Transcript excerpts from the top occurrences by weight: ${JSON.stringify(excerpts)}`
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
  progress?: (line: string) => void
}): Promise<ConfirmationOutcome> {
  const findings: Finding[] = []
  const failures: ConfirmationFailure[] = []
  const maxCalls = opts.maxCallsPerFinding ?? 3
  for (const [index, candidate] of opts.candidates.entries()) {
    const callsBefore = opts.engine.stats().calls
    const started = Date.now()
    const total = opts.candidates.length
    const label = candidate.chain.join('→')
    opts.progress?.(`confirming ${index + 1}/${total}: ${label} … call 1\n`)
    let completion: 'confirmed' | 'rejected' | 'failed' = 'rejected'
    try {
      const excerpts = await topOccurrenceExcerpts(candidate)
      const response = await opts.engine.analyze(confirmationPrompt(candidate, excerpts), {
        timeoutMs: confirmationTimeoutMs,
        jsonSchema: confirmationJsonSchema
      })
      const calls = opts.engine.stats().calls - callsBefore
      if (calls > maxCalls) throw new Error(`engine call budget exceeded (${calls}/${maxCalls})`)
      if (Date.now() - started >= 90_000) throw new Error('confirmation exceeded the 90s finding budget')
      const finding = findingFromResponse(candidate, response, calls)
      if (finding) {
        opts.store.upsertFinding({
          id: finding.id,
          lens: 'handoff',
          kind: 'relay',
          createdAt: new Date().toISOString(),
          status: 'suggested',
          payload: finding
        })
        findings.push(finding)
        completion = 'confirmed'
      }
    } catch (error) {
      completion = 'failed'
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
    const calls = opts.engine.stats().calls - callsBefore
    const seconds = Math.round((Date.now() - started) / 1000)
    opts.progress?.(
      `${completion} ${index + 1}/${total}: ${candidate.id} (${calls} call(s), ${seconds}s)\n`
    )
  }
  return { findings, failures }
}
