import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { createClaudeEngine } from '../../src/engines/claude.js'
import type { AnalysisEngine, EngineOpts, EngineStats } from '../../src/engines/engine.js'
import { confirmHandoffCandidates } from '../../src/lenses/handoff/confirm.js'
import type { Candidate } from '../../src/lenses/lens.js'
import { resolvePaths } from '../../src/paths.js'
import { openSubstrate } from '../../src/substrate/store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { installFakeAgents, setFakeAgentScript } from '../helpers/fake-agents.js'

afterEach(cleanupTempDirs)

class CapturingEngine implements AnalysisEngine {
  readonly id = 'claude'
  calls = 0
  timeouts: Array<number | undefined> = []

  async analyze(_prompt: string, opts: EngineOpts = {}): Promise<unknown> {
    this.calls += 1
    this.timeouts.push(opts.timeoutMs)
    return {
      confirmed: true,
      reason: 'Repeated handoff',
      relay: {
        slug: 'plan-build',
        hops: [
          { runtime: 'claude', role: 'plan', autonomy: 'challenge', prompt: 'Plan.' },
          { runtime: 'codex', role: 'implement', autonomy: 'challenge', prompt: 'Build.' }
        ]
      }
    }
  }

  stats(): EngineStats {
    return { calls: this.calls, usage: {} }
  }
}

test('confirmation sends excerpts only from the highest-weighted occurrence', async () => {
  const root = await makeTempDir()
  const high = join(root, 'highest.jsonl')
  const low = join(root, 'lower.jsonl')
  await writeFile(high, JSON.stringify({
    type: 'user', message: { role: 'user', content: 'HIGHEST_PRIVATE_EXCERPT' }
  }))
  await writeFile(low, JSON.stringify({
    type: 'user', message: { role: 'user', content: 'LOWER_PRIVATE_EXCERPT' }
  }))
  const fake = await installFakeAgents(root)
  await setFakeAgentScript(fake.scriptPath, {
    stdout: [{
      type: 'result',
      result: JSON.stringify({
        confirmed: true,
        reason: 'Repeated handoff',
        relay: {
          slug: 'plan-build',
          hops: [
            { runtime: 'claude', role: 'plan', autonomy: 'challenge', prompt: 'Plan.' },
            { runtime: 'codex', role: 'implement', autonomy: 'challenge', prompt: 'Build.' }
          ]
        }
      })
    }]
  })
  const occurrence = (ref: string, weight: number) => ({
    repoRoot: '/private/repo-name',
    sessionIds: [`session-${weight}`],
    refs: [ref],
    sourceIds: ['claude-code'],
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T10:10:00.000Z',
    durationMinutes: 10,
    weight,
    gitCorrelated: false,
    continuationPairs: 0
  })
  const candidate: Candidate = {
    id: 'handoff-test',
    lens: 'handoff',
    pattern: 'claude-code>codex',
    chain: ['claude-code', 'codex'],
    surfaced: true,
    occurrences: [occurrence(high, 2), occurrence(low, 1)],
    evidence: {
      occurrenceCount: 2,
      sessionCount: 4,
      dates: ['2026-01-01'],
      repos: ['/private/repo-name'],
      totalMinutes: 20,
      medianMinutes: 10
    }
  }
  const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  const engine = createClaudeEngine(fake.env)
  const outcome = await confirmHandoffCandidates({ store, candidates: [candidate], engine })

  expect(outcome.failures).toEqual([])
  expect(outcome.findings[0]).toMatchObject({ confirmed: true, engineCalls: 1 })
  const prompt = await readFile(fake.stdinPath, 'utf8')
  expect(prompt).toContain('HIGHEST_PRIVATE_EXCERPT')
  expect(prompt).not.toContain('LOWER_PRIVATE_EXCERPT')
  expect(prompt).not.toContain(high)
  expect(prompt).not.toContain('/private/repo-name')
  expect(store.getFinding(candidate.id)).toMatchObject({ kind: 'relay', status: 'suggested' })
  store.close()
})

test('confirmation allows more than 30 seconds while reserving the drafting budget', async () => {
  const root = await makeTempDir()
  const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  const candidate: Candidate = {
    id: 'handoff-timeout',
    lens: 'handoff',
    pattern: 'claude-code>codex',
    chain: ['claude-code', 'codex'],
    surfaced: true,
    occurrences: [],
    evidence: {
      occurrenceCount: 2,
      sessionCount: 4,
      dates: ['2026-01-01'],
      repos: ['/redacted/repo'],
      totalMinutes: 20,
      medianMinutes: 10
    }
  }
  const engine = new CapturingEngine()

  await confirmHandoffCandidates({ store, candidates: [candidate], engine })
  expect(engine.timeouts).toEqual([60_000])
  store.close()
})
