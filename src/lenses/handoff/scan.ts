import { createHash } from 'node:crypto'

import { digestSimilarity, intentSimilarityThreshold } from '../../digest.js'
import type { StoredSession, SubstrateStore } from '../../substrate/store.js'
import type { Candidate, CandidateOccurrence, LensEvidence, LensOpts } from '../lens.js'
import { correlatedSessionEnds } from './git-correlation.js'

const chainWindowMs = 6 * 60 * 60 * 1000

interface SessionChain {
  sessions: StoredSession[]
}

function isToolInvoked(session: StoredSession): boolean {
  return session.sourceId === 'codex'
    && (session.originator === 'codex_exec' || session.meta.toolInvoked === true)
}

function groupByRepo(sessions: StoredSession[]): Map<string, StoredSession[]> {
  const repos = new Map<string, StoredSession[]>()
  for (const session of sessions) {
    if (isToolInvoked(session)) continue
    const current = repos.get(session.repoRoot) ?? []
    current.push(session)
    repos.set(session.repoRoot, current)
  }
  for (const values of repos.values()) {
    values.sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  }
  return repos
}

function alternatingChains(sessions: StoredSession[]): SessionChain[] {
  const chains: SessionChain[] = []
  let current: StoredSession[] = []
  for (const session of sessions) {
    if (current.length === 0) {
      current = [session]
      continue
    }
    const first = current[0]
    const last = current.at(-1)
    if (!first || !last) continue
    const insideWindow = Date.parse(session.startedAt) - Date.parse(first.startedAt) <= chainWindowMs
    if (!insideWindow) {
      if (new Set(current.map(({ sourceId }) => sourceId)).size >= 2) chains.push({ sessions: current })
      current = [session]
      continue
    }
    if (last.sourceId === session.sourceId) {
      current[current.length - 1] = session
    } else {
      current.push(session)
    }
  }
  if (new Set(current.map(({ sourceId }) => sourceId)).size >= 2) chains.push({ sessions: current })
  return chains
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const right = sorted[middle] ?? 0
  return sorted.length % 2 === 1 ? right : ((sorted[middle - 1] ?? 0) + right) / 2
}

function evidence(occurrences: CandidateOccurrence[]): LensEvidence {
  const durationMinutes = occurrences.map(({ durationMinutes: duration }) => duration)
  return {
    occurrenceCount: occurrences.length,
    sessionCount: occurrences.reduce((sum, occurrence) => sum + occurrence.sessionIds.length, 0),
    dates: [...new Set(occurrences.map(({ startedAt }) => startedAt.slice(0, 10)))].sort(),
    repos: [...new Set(occurrences.map(({ repoRoot }) => repoRoot))].sort(),
    totalMinutes: Math.round(durationMinutes.reduce((sum, value) => sum + value, 0) * 100) / 100,
    medianMinutes: Math.round(median(durationMinutes) * 100) / 100
  }
}

function candidateId(pattern: string): string {
  return `handoff-${createHash('sha256').update(pattern).digest('hex').slice(0, 16)}`
}

async function occurrence(chain: SessionChain): Promise<CandidateOccurrence> {
  const first = chain.sessions[0]
  const last = chain.sessions.at(-1)
  if (!first || !last) throw new Error('handoff chain cannot be empty')
  const correlated = await correlatedSessionEnds(
    first.repoRoot,
    chain.sessions.map(({ endedAt }) => endedAt)
  )
  let continuationPairs = 0
  for (let index = 1; index < chain.sessions.length; index += 1) {
    const previous = chain.sessions[index - 1]
    const current = chain.sessions[index]
    if (
      previous
      && current
      && digestSimilarity(previous.intentDigest, current.intentDigest) < intentSimilarityThreshold
    ) continuationPairs += 1
  }
  const pairCount = Math.max(1, chain.sessions.length - 1)
  const gitRatio = correlated.size / chain.sessions.length
  const continuationRatio = continuationPairs / pairCount
  const durationMinutes = chain.sessions.reduce((sum, session) => {
    return sum + Math.max(0, Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000
  }, 0)
  return {
    repoRoot: first.repoRoot,
    sessionIds: chain.sessions.map(({ id }) => id),
    refs: chain.sessions.map(({ ref }) => ref),
    sourceIds: chain.sessions.map(({ sourceId }) => sourceId),
    startedAt: first.startedAt,
    endedAt: last.endedAt,
    durationMinutes: Math.round(durationMinutes * 100) / 100,
    weight: Math.round((1 + gitRatio * 0.5 + continuationRatio * 0.25) * 1000) / 1000,
    gitCorrelated: correlated.size > 0,
    continuationPairs
  }
}

export async function scanHandoff(
  store: SubstrateStore,
  opts: LensOpts = {}
): Promise<Candidate[]> {
  const sessions = store.listSessions({
    ...(opts.sourceIds ? { sourceIds: opts.sourceIds } : {}),
    ...(opts.since ? { since: opts.since } : {})
  })
  const byPattern = new Map<string, CandidateOccurrence[]>()
  for (const repoSessions of groupByRepo(sessions).values()) {
    for (const chain of alternatingChains(repoSessions)) {
      const item = await occurrence(chain)
      const pattern = item.sourceIds.join('>')
      const values = byPattern.get(pattern) ?? []
      values.push(item)
      byPattern.set(pattern, values)
    }
  }

  const surfaced: Candidate[] = []
  for (const [pattern, occurrences] of byPattern) {
    occurrences.sort((left, right) => right.weight - left.weight || left.startedAt.localeCompare(right.startedAt))
    const candidateEvidence = evidence(occurrences)
    const meetsFloor = candidateEvidence.sessionCount >= 3 || candidateEvidence.repos.length >= 2
    const candidate: Candidate = {
      id: candidateId(pattern),
      lens: 'handoff',
      pattern,
      chain: pattern.split('>'),
      surfaced: meetsFloor,
      occurrences,
      evidence: candidateEvidence
    }
    store.upsertFinding({
      id: candidate.id,
      lens: 'handoff',
      kind: 'handoff-candidate',
      createdAt: new Date().toISOString(),
      status: 'suggested',
      payload: candidate
    })
    if (meetsFloor) surfaced.push(candidate)
  }
  return surfaced.sort((left, right) => {
    const weight = (right.occurrences[0]?.weight ?? 0) - (left.occurrences[0]?.weight ?? 0)
    return weight || left.id.localeCompare(right.id)
  })
}
