import { expect, test } from 'vitest'

import { draftRelay, persistedDraft } from '../../src/artifacts/draft-relay.js'
import { compileRelay } from '../../src/artifacts/relay-compiler.js'
import type { AnalysisEngine, EngineOpts, EngineStats } from '../../src/engines/engine.js'
import type { Finding } from '../../src/lenses/lens.js'

function finding(draft: unknown): Finding {
  return {
    id: 'handoff-test',
    lens: 'handoff',
    kind: 'relay',
    pattern: 'claude-code>codex>claude-code',
    chain: ['claude-code', 'codex', 'claude-code'],
    surfaced: true,
    confirmed: true,
    confirmation: 'Repeated coherent workflow',
    engineCalls: 1,
    draft,
    occurrences: [],
    evidence: {
      occurrenceCount: 1,
      sessionCount: 3,
      dates: ['2026-01-01'],
      repos: ['/repo'],
      totalMinutes: 60,
      medianMinutes: 60
    }
  }
}

class FakeEngine implements AnalysisEngine {
  readonly id = 'claude'
  calls = 0
  prompts: string[] = []
  timeouts: Array<number | undefined> = []
  schemas: Array<Record<string, unknown> | undefined> = []
  response: unknown

  constructor(response: unknown) {
    this.response = response
  }

  async analyze(prompt: string, opts: EngineOpts = {}): Promise<unknown> {
    this.calls += 1
    this.prompts.push(prompt)
    this.timeouts.push(opts.timeoutMs)
    this.schemas.push(opts.jsonSchema)
    return this.response
  }

  stats(): EngineStats {
    return { calls: this.calls, usage: {} }
  }
}

const draft = {
  slug: 'plan-implement-review',
  hops: [
    { runtime: 'claude', role: 'plan', autonomy: 'challenge', prompt: 'Plan this work.' },
    { runtime: 'codex', role: 'implement', autonomy: 'challenge', prompt: 'Implement the plan.' },
    { runtime: 'claude', role: 'review', autonomy: 'autonomous', prompt: 'Review the result.' }
  ]
}

test('a confirmed engine draft validates and compiles with implementer-formatted templates', async () => {
  const engine = new FakeEngine({})
  const result = await draftRelay(finding(draft), engine)
  expect(engine.calls).toBe(0)
  expect(result.relay.hops).toHaveLength(3)
  expect(result.templates['plan.md']).toMatch(/structured task breakdown.*manifest/is)
  expect(result.templates['implement.md']).toMatch(/challenge-notes\.md/)
  const plan = compileRelay({
    relay: result.relay,
    dir: '/generated',
    repoRoot: '/repo',
    templates: new Map(Object.entries(result.templates))
  })
  expect(plan.hops).toHaveLength(3)
})

test('drafting can use one fallback call and rejects a budget overrun cleanly', async () => {
  const engine = new FakeEngine(draft)
  await expect(draftRelay(finding(null), engine)).resolves.toMatchObject({
    slug: 'plan-implement-review'
  })
  expect(engine.calls).toBe(1)
  expect(engine.timeouts).toEqual([25_000])
  expect(engine.prompts[0]).not.toContain('/repo')
  expect(engine.schemas[0]).toMatchObject({
    type: 'object',
    required: ['slug', 'hops']
  })
  expect(JSON.stringify(engine.schemas[0])).toContain('"prompt"')

  const overBudget = new FakeEngine(draft)
  const budgetSpent = finding(null)
  budgetSpent.engineCalls = 3
  await expect(draftRelay(budgetSpent, overBudget)).rejects.toThrow(/budget/i)
  expect(overBudget.calls).toBe(0)
})

test('persisted drafts reject unreferenced template path traversal', () => {
  expect(() => persistedDraft({
    slug: 'safe-relay',
    relayJson: {
      slug: 'safe-relay',
      hops: [{
        runtime: 'claude',
        role: 'plan',
        autonomy: 'challenge',
        promptTemplate: 'plan.md',
        produces: ['spec.md']
      }]
    },
    templates: {
      'plan.md': 'Plan safely.',
      '../outside.md': 'Do not write this.'
    }
  })).toThrow(/template.*filename/i)
})
