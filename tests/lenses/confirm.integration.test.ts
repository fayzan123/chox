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
  prompts: string[] = []
  timeouts: Array<number | undefined> = []
  schemas: Array<Record<string, unknown> | undefined> = []

  async analyze(prompt: string, opts: EngineOpts = {}): Promise<unknown> {
    this.calls += 1
    this.prompts.push(prompt)
    this.timeouts.push(opts.timeoutMs)
    this.schemas.push(opts.jsonSchema)
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

function candidateWithOccurrence(id: string, interleaved: boolean): Candidate {
  const first = {
    sourceId: 'claude-code',
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T10:30:00.000Z'
  }
  const second = {
    sourceId: 'codex',
    startedAt: interleaved ? '2026-01-01T10:10:00.000Z' : '2026-01-01T11:00:00.000Z',
    endedAt: interleaved ? '2026-01-01T10:20:00.000Z' : '2026-01-01T11:10:00.000Z'
  }
  return {
    id,
    lens: 'handoff',
    pattern: 'claude-code>codex',
    chain: ['claude-code', 'codex'],
    surfaced: true,
    occurrences: [{
      repoRoot: '/redacted/repo',
      sessionIds: ['session-a', 'session-b'],
      refs: [],
      sourceIds: ['claude-code', 'codex'],
      sessions: [first, second],
      interleaved,
      startedAt: first.startedAt,
      endedAt: second.endedAt,
      durationMinutes: 40,
      weight: 1,
      gitCorrelated: false,
      continuationPairs: 1
    }],
    evidence: {
      occurrenceCount: 1,
      sessionCount: 2,
      dates: ['2026-01-01'],
      repos: ['/redacted/repo'],
      totalMinutes: 40,
      medianMinutes: 40
    }
  }
}

test('confirmation splits excerpts across the top occurrences within the 1b allowance', async () => {
  const root = await makeTempDir()
  const names = ['one', 'two', 'three', 'four']
  const occurrences = []
  for (const [index, name] of names.entries()) {
    const claudeRef = join(root, `occurrence-${name}-claude.jsonl`)
    const codexRef = join(root, `occurrence-${name}-codex.jsonl`)
    await writeFile(claudeRef, JSON.stringify({
      type: 'user', message: { role: 'user', content: `occurrence-${name}-alpha` }
    }))
    await writeFile(codexRef, JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: `occurrence-${name}-beta` }]
      }
    }))
    const startedAt = `2026-01-0${index + 1}T10:00:00.000Z`
    const endedAt = `2026-01-0${index + 1}T10:20:00.000Z`
    occurrences.push({
      repoRoot: '/private/repo-name',
      sessionIds: [`session-${name}-a`, `session-${name}-b`],
      refs: [claudeRef, codexRef],
      sourceIds: ['claude-code', 'codex'],
      sessions: [
        { sourceId: 'claude-code', startedAt, endedAt },
        { sourceId: 'codex', startedAt, endedAt }
      ],
      interleaved: true,
      startedAt,
      endedAt,
      durationMinutes: 20,
      weight: names.length - index,
      gitCorrelated: false,
      continuationPairs: 1
    })
  }
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
  const candidate: Candidate = {
    id: 'handoff-test',
    lens: 'handoff',
    pattern: 'claude-code>codex',
    chain: ['claude-code', 'codex'],
    surfaced: true,
    occurrences,
    evidence: {
      occurrenceCount: 4,
      sessionCount: 8,
      dates: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'],
      repos: ['/private/repo-name'],
      totalMinutes: 80,
      medianMinutes: 20
    }
  }
  const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  const engine = createClaudeEngine(fake.env)
  const outcome = await confirmHandoffCandidates({ store, candidates: [candidate], engine })

  expect(outcome.failures).toEqual([])
  expect(outcome.findings[0]).toMatchObject({ confirmed: true, engineCalls: 1 })
  const prompt = await readFile(fake.stdinPath, 'utf8')
  for (const name of names.slice(0, 3)) expect(prompt).toContain(`occurrence-${name}-alpha`)
  expect(prompt).not.toContain('occurrence-four-alpha')
  const label = 'Transcript excerpts from the top occurrences by weight: '
  const excerpts = JSON.parse(prompt.slice(prompt.indexOf(label) + label.length)) as Array<{
    occurrence: number
    excerpt: string
  }>
  expect(new Set(excerpts.map(({ occurrence }) => occurrence)).size).toBeGreaterThanOrEqual(2)
  expect(excerpts.reduce((sum, { excerpt }) => sum + excerpt.length, 0))
    .toBeLessThanOrEqual(3000 * candidate.chain.length)
  expect(prompt).not.toContain(join(root, 'occurrence-one-claude.jsonl'))
  expect(prompt).not.toContain('/private/repo-name')
  expect(store.getFinding(candidate.id)).toMatchObject({ kind: 'relay', status: 'suggested' })
  store.close()
})

test('confirmation prompt includes concurrency-honest session timing metadata', async () => {
  const root = await makeTempDir()
  const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  const engine = new CapturingEngine()
  const concurrent = candidateWithOccurrence('handoff-concurrent', true)
  const disjoint = candidateWithOccurrence('handoff-disjoint', false)

  await confirmHandoffCandidates({ store, candidates: [concurrent, disjoint], engine })

  expect(engine.prompts[0]).toContain('interleaved:true ran concurrently')
  expect(engine.prompts[0]).toContain('"interleaved":true')
  expect(engine.prompts[0]).toContain('2026-01-01T10:00:00.000Z')
  expect(engine.prompts[0]).toContain('2026-01-01T10:30:00.000Z')
  expect(engine.prompts[0]).toContain('2026-01-01T10:10:00.000Z')
  expect(engine.prompts[0]).toContain('2026-01-01T10:20:00.000Z')
  expect(engine.prompts[1]).toContain('"interleaved":false')
  store.close()
})

test('confirmation reports one start and completion progress line per candidate', async () => {
  const root = await makeTempDir()
  const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  const engine = new CapturingEngine()
  const candidate = candidateWithOccurrence('handoff-0123456789abcdef', false)
  const progress: string[] = []

  await confirmHandoffCandidates({
    store,
    candidates: [candidate],
    engine,
    progress: (line) => progress.push(line)
  })

  expect(progress).toHaveLength(2)
  expect(progress[0]?.trim()).toBe('confirming 1/1: claude-code→codex … call 1')
  expect(progress[1]?.trim()).toMatch(
    /^confirmed 1\/1: handoff-[0-9a-f]{16} \(\d+ call\(s\), \d+s\)$/
  )
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

test('confirmation requires a validated response with a complete relay draft', async () => {
  const root = await makeTempDir()
  const store = openSubstrate(resolvePaths({ CHOX_HOME: join(root, 'chox-home') }))
  const candidate: Candidate = {
    id: 'handoff-schema',
    lens: 'handoff',
    pattern: 'claude-code>codex',
    chain: ['claude-code', 'codex'],
    surfaced: true,
    occurrences: [],
    evidence: {
      occurrenceCount: 3,
      sessionCount: 6,
      dates: ['2026-01-01'],
      repos: ['/redacted/repo'],
      totalMinutes: 30,
      medianMinutes: 10
    }
  }
  const engine = new CapturingEngine()

  const outcome = await confirmHandoffCandidates({ store, candidates: [candidate], engine })

  expect(outcome.failures).toEqual([])
  expect(engine.schemas).toHaveLength(1)
  expect(engine.schemas[0]).toMatchObject({
    type: 'object',
    required: ['confirmed', 'reason', 'relay']
  })
  expect(JSON.stringify(engine.schemas[0])).toContain('"hops"')
  expect(JSON.stringify(engine.schemas[0])).toContain('"autonomy"')
  store.close()
})
