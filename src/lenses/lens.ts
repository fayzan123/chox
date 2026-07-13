import type { AnalysisEngine } from '../engines/engine.js'
import type { SubstrateStore } from '../substrate/store.js'

export interface LensEvidence {
  occurrenceCount: number
  sessionCount: number
  dates: string[]
  repos: string[]
  totalMinutes: number
  medianMinutes: number
}

export interface CandidateOccurrence {
  repoRoot: string
  sessionIds: string[]
  refs: string[]
  sourceIds: string[]
  startedAt: string
  endedAt: string
  durationMinutes: number
  weight: number
  gitCorrelated: boolean
  continuationPairs: number
}

export interface Candidate {
  id: string
  lens: 'handoff'
  pattern: string
  chain: string[]
  surfaced: boolean
  occurrences: CandidateOccurrence[]
  evidence: LensEvidence
}

export interface Finding extends Candidate {
  kind: 'relay'
  confirmed: true
  confirmation: string
  engineCalls: number
  draft: unknown
}

export interface LensOpts {
  sourceIds?: string[]
  since?: string
}

export interface Lens {
  id: 'handoff' | 'profile' | 'repetition'
  scan(store: SubstrateStore, opts: LensOpts): Promise<Candidate[]>
  confirm(candidates: Candidate[], engine: AnalysisEngine): Promise<Finding[]>
}
