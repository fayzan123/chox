import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { scanHandoffReport } from '../../src/lenses/handoff/scan.js'
import { applySubsumption, isContiguousSubsequence } from '../../src/lenses/handoff/subsume.js'
import type { Candidate, CandidateOccurrence } from '../../src/lenses/lens.js'
import { resolvePaths } from '../../src/paths.js'
import type { ParsedSession } from '../../src/sources/source.js'
import { openSubstrate, type SubstrateStore } from '../../src/substrate/store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

function occurrence(repoRoot: string, sessionIds: string[], sourceIds: string[]): CandidateOccurrence {
  return {
    repoRoot,
    sessionIds,
    refs: sessionIds.map((id) => `/fixtures/${id}.jsonl`),
    sourceIds,
    sessions: sourceIds.map((sourceId, index) => ({
      sourceId,
      startedAt: `2026-01-01T${String(index).padStart(2, '0')}:00:00.000Z`,
      endedAt: `2026-01-01T${String(index).padStart(2, '0')}:10:00.000Z`
    })),
    interleaved: false,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:10:00.000Z',
    durationMinutes: 10,
    weight: 1,
    gitCorrelated: false,
    continuationPairs: Math.max(0, sourceIds.length - 1)
  }
}

function candidate(pattern: string, occurrences: CandidateOccurrence[], id = `handoff-${pattern}`): Candidate {
  const chain = pattern.split('>')
  return {
    id,
    lens: 'handoff',
    pattern,
    chain,
    surfaced: true,
    occurrences,
    evidence: {
      occurrenceCount: occurrences.length,
      sessionCount: occurrences.reduce((sum, item) => sum + item.sessionIds.length, 0),
      dates: ['2026-01-01'],
      repos: [...new Set(occurrences.map(({ repoRoot }) => repoRoot))],
      totalMinutes: 10 * occurrences.length,
      medianMinutes: 10
    }
  }
}

test('recognizes contiguous subsequences while rejecting gaps and empty inputs', () => {
  expect(isContiguousSubsequence(['b', 'c'], ['a', 'b', 'c', 'd'])).toBe(true)
  expect(isContiguousSubsequence(['a', 'c'], ['a', 'b', 'c'])).toBe(false)
  expect(isContiguousSubsequence(['a', 'b'], ['a', 'b'])).toBe(true)
  expect(isContiguousSubsequence([], ['a'])).toBe(false)
})

test('subsumes fully contained prefix occurrences but keeps partial evidence alive', () => {
  const short = candidate('claude-code>codex', [
    occurrence('/repo-a', ['s1', 's2'], ['claude-code', 'codex']),
    occurrence('/repo-b', ['s4', 's5'], ['claude-code', 'codex'])
  ], 'short')
  const long = candidate('claude-code>codex>claude-code', [
    occurrence('/repo-a', ['s1', 's2', 's3'], ['claude-code', 'codex', 'claude-code']),
    occurrence('/repo-b', ['s4', 's5', 's6'], ['claude-code', 'codex', 'claude-code'])
  ], 'long')
  applySubsumption([short, long])
  expect(short.subsumedBy).toBe('long')

  const independent = candidate('claude-code>codex', [
    ...short.occurrences,
    occurrence('/repo-c', ['s7', 's8'], ['claude-code', 'codex'])
  ], 'independent')
  applySubsumption([independent, long])
  expect(independent.subsumedBy).toBeUndefined()
})

test('requires same-repo occurrence containment and accepts non-prefix subchains', () => {
  const repoMismatch = candidate('claude-code>codex', [
    occurrence('/repo-b', ['s1', 's2'], ['claude-code', 'codex'])
  ], 'repo-mismatch')
  const long = candidate('claude-code>codex>claude-code', [
    occurrence('/repo-a', ['s1', 's2', 's3'], ['claude-code', 'codex', 'claude-code'])
  ], 'long')
  applySubsumption([repoMismatch, long])
  expect(repoMismatch.subsumedBy).toBeUndefined()

  const tail = candidate('codex>claude-code', [
    occurrence('/repo-a', ['s2', 's3'], ['codex', 'claude-code'])
  ], 'tail')
  applySubsumption([tail, long])
  expect(tail.subsumedBy).toBe('long')
})

test('selects the longest qualifying candidate and then the smallest id', () => {
  const short = candidate('codex>claude-code', [
    occurrence('/repo', ['s2', 's3'], ['codex', 'claude-code'])
  ], 'short')
  const threeZ = candidate('claude-code>codex>claude-code', [
    occurrence('/repo', ['s1', 's2', 's3'], ['claude-code', 'codex', 'claude-code'])
  ], 'z-three')
  const threeA = candidate('codex>claude-code>codex', [
    occurrence('/repo', ['s2', 's3', 's4'], ['codex', 'claude-code', 'codex'])
  ], 'a-three')
  const four = candidate('claude-code>codex>claude-code>codex', [
    occurrence('/repo', ['s1', 's2', 's3', 's4'], ['claude-code', 'codex', 'claude-code', 'codex'])
  ], 'four')
  applySubsumption([short, threeZ, threeA, four])
  expect(short.subsumedBy).toBe('four')

  const equalChoice = candidate('codex>claude-code', [
    occurrence('/repo', ['s2', 's3'], ['codex', 'claude-code'])
  ], 'equal-choice')
  const equalZ = candidate('claude-code>codex>claude-code', [
    occurrence('/repo', ['s1', 's2', 's3'], ['claude-code', 'codex', 'claude-code'])
  ], 'z-three')
  const equalA = candidate('codex>claude-code>codex', [
    occurrence('/repo', ['s2', 's3', 's4'], ['codex', 'claude-code', 'codex'])
  ], 'a-three')
  applySubsumption([equalChoice, equalZ, equalA])
  expect(equalChoice.subsumedBy).toBe('a-three')
})

test('equal-length and below-floor candidates do not participate', () => {
  const first = candidate('claude-code>codex', [
    occurrence('/repo', ['s1', 's2'], ['claude-code', 'codex'])
  ], 'first')
  const second = candidate('claude-code>codex', [
    occurrence('/repo', ['s1', 's2'], ['claude-code', 'codex'])
  ], 'second')
  second.surfaced = false
  applySubsumption([first, second])
  expect(first.subsumedBy).toBeUndefined()
  expect(second.subsumedBy).toBeUndefined()
})

function addSession(store: SubstrateStore, input: {
  id: string
  sourceId: 'claude-code' | 'codex'
  repoRoot: string
  startedAt: string
}): void {
  store.upsertSource({ id: input.sourceId, kind: input.sourceId, rootPath: '/fixture' })
  const endedAt = new Date(Date.parse(input.startedAt) + 10 * 60_000).toISOString()
  const parsed: ParsedSession = {
    meta: {
      id: input.id,
      cwd: input.repoRoot,
      repoRoot: input.repoRoot,
      startedAt: input.startedAt,
      endedAt,
      metadata: {}
    },
    units: [{
      id: `${input.id}:session`,
      startedAt: input.startedAt,
      endedAt,
      intentDigest: input.id,
      metadata: {}
    }],
    diagnostics: { unknownTypes: {}, nullLines: 0, failedFiles: [] }
  }
  store.replaceSession(input.sourceId, `/fixtures/${input.id}.jsonl`, parsed)
}

test('ordinary organic scans return surfaced candidates without subsumption', async () => {
  const root = await makeTempDir()
  const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  const repoRoot = join(root, 'repo')
  for (const [index, sourceId] of ['claude-code', 'codex', 'claude-code'].entries()) {
    addSession(store, {
      id: `session-${index}`,
      sourceId: sourceId as 'claude-code' | 'codex',
      repoRoot,
      startedAt: `2026-01-01T1${index}:00:00.000Z`
    })
  }

  const report = await scanHandoffReport(store)
  expect(report.subsumed).toEqual([])
  expect(report.surfaced.every(({ subsumedBy }) => subsumedBy === undefined)).toBe(true)
  store.close()
})
