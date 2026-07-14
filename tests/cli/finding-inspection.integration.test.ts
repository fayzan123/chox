import { afterEach, expect, test } from 'vitest'
import { join } from 'node:path'

import { runCli, type CliContext } from '../../bin/chox.js'
import { resolvePaths } from '../../src/paths.js'
import { openSubstrate, type StoredFinding } from '../../src/substrate/store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { initGitRepo } from '../helpers/git.js'

afterEach(cleanupTempDirs)

function context(overrides: Partial<CliContext> = {}) {
  const stdout: string[] = []
  const stderr: string[] = []
  const ctx: CliContext = {
    cwd: process.cwd(),
    env: { ...process.env },
    stdinIsTTY: false,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    ...overrides
  }
  return { ctx, stdout, stderr }
}

function candidate(id: string, repoRoot: string): Record<string, unknown> {
  return {
    id,
    lens: 'handoff',
    pattern: 'claude-code>codex>claude-code',
    chain: ['claude-code', 'codex', 'claude-code'],
    surfaced: true,
    occurrences: [],
    evidence: {
      occurrenceCount: 4,
      sessionCount: 12,
      dates: ['2026-07-01', '2026-07-10'],
      repos: [repoRoot],
      totalMinutes: 180,
      medianMinutes: 45
    }
  }
}

function draftedRelay(taskable = true) {
  return {
    slug: 'proposed-workflow',
    relayJson: {
      slug: 'proposed-workflow',
      gates: 'all-boundaries',
      hops: [{
        runtime: 'claude',
        role: 'plan',
        promptTemplate: 'plan.md',
        autonomy: 'challenge',
        produces: ['spec.md']
      }]
    },
    templates: {
      'plan.md': `# Plan the work\nSECRET FULL PROMPT DETAIL${taskable ? '\n\n## Task\n{{task}}' : ''}\n`
    }
  }
}

test('finding show handles suggested, covered, subsumed, and dismissed findings with JSON-safe disclosure', async () => {
  const root = await makeTempDir()
  const repoRoot = await initGitRepo(root)
  const env = { ...process.env, CHOX_HOME: join(root, 'chox-home') }
  const paths = resolvePaths(env)
  const store = openSubstrate(paths)
  const findings: StoredFinding[] = [
    {
      id: 'suggested-finding',
      lens: 'handoff',
      kind: 'relay',
      createdAt: '2026-07-14T00:00:00.000Z',
      status: 'suggested',
      payload: {
        ...candidate('suggested-finding', repoRoot),
        kind: 'relay',
        confirmed: true,
        confirmation: 'The workflow is coherent.',
        engineCalls: 1,
        draftedRelay: draftedRelay(),
        inspection: {
          engine: 'claude',
          model: 'sonnet-test',
          callCeiling: 3,
          calls: 2,
          usage: { inputTokens: 80, outputTokens: 20 }
        }
      }
    },
    {
      id: 'covered-finding',
      lens: 'handoff',
      kind: 'handoff-candidate',
      createdAt: '2026-07-14T00:00:00.000Z',
      status: 'suggested',
      payload: {
        ...candidate('covered-finding', repoRoot),
        coveredBy: 'spec-implement-review'
      }
    },
    {
      id: 'subsumed-finding',
      lens: 'handoff',
      kind: 'handoff-candidate',
      createdAt: '2026-07-14T00:00:00.000Z',
      status: 'suggested',
      payload: {
        ...candidate('subsumed-finding', repoRoot),
        subsumedBy: 'longer-finding'
      }
    },
    {
      id: 'dismissed-finding',
      lens: 'handoff',
      kind: 'relay',
      createdAt: '2026-07-14T00:00:00.000Z',
      status: 'dismissed',
      payload: {
        ...candidate('dismissed-finding', repoRoot),
        kind: 'relay',
        confirmed: true,
        confirmation: 'Dismissed by the user.',
        engineCalls: 1,
        draftedRelay: draftedRelay()
      }
    },
    {
      id: 'legacy-finding',
      lens: 'handoff',
      kind: 'relay',
      createdAt: '2026-07-14T00:00:00.000Z',
      status: 'suggested',
      payload: {
        ...candidate('legacy-finding', repoRoot),
        kind: 'relay',
        confirmed: true,
        confirmation: 'Predates taskable drafting.',
        engineCalls: 1,
        draft: {},
        draftedRelay: draftedRelay(false)
      }
    }
  ]
  for (const finding of findings) store.upsertFinding(finding)
  store.close()

  const summary = context({ cwd: repoRoot, env })
  expect(await runCli(['finding', 'show', 'suggested-finding'], summary.ctx)).toBe(0)
  expect(summary.stdout.join('')).toMatch(
    /State: suggested[\s\S]*4 occurrence\(s\), 12 session\(s\)[\s\S]*Engine: claude[\s\S]*Model: sonnet-test[\s\S]*Actual spend: 2 call\(s\)/
  )
  expect(summary.stdout.join('')).toContain('Prompt: # Plan the work')
  expect(summary.stdout.join('')).not.toContain('SECRET FULL PROMPT DETAIL')

  const prompts = context({ cwd: repoRoot, env })
  expect(await runCli([
    'finding', 'show', 'suggested-finding', '--prompts', '--json'
  ], prompts.ctx)).toBe(0)
  const proposed = JSON.parse(prompts.stdout.join('')) as {
    state: string
    analysis: { engine: string, model: string, callCeiling: number, calls: number }
    workflow: { taskRequired: boolean, hops: Array<{ prompt?: string }> }
  }
  expect(proposed).toMatchObject({
    state: 'suggested',
    analysis: { engine: 'claude', model: 'sonnet-test', callCeiling: 3, calls: 2 },
    workflow: { taskRequired: true }
  })
  expect(proposed.workflow.hops[0]?.prompt).toContain('SECRET FULL PROMPT DETAIL')

  for (const [id, state] of [
    ['covered-finding', 'covered'],
    ['subsumed-finding', 'subsumed'],
    ['dismissed-finding', 'dismissed']
  ] as const) {
    const output = context({ cwd: repoRoot, env })
    expect(await runCli(['finding', 'show', id, '--json'], output.ctx)).toBe(0)
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({ id, state })
  }

  const covered = context({ cwd: repoRoot, env })
  expect(await runCli(['finding', 'show', 'covered-finding'], covered.ctx)).toBe(0)
  expect(covered.stdout.join('')).toContain('Inspect: chox relay show spec-implement-review')
  expect(covered.stdout.join('')).toContain(
    'Next: chox run spec-implement-review --task-file <task.md> --dry-run'
  )

  const legacyInstall = context({ cwd: repoRoot, env })
  expect(await runCli(['install', 'legacy-finding'], legacyInstall.ctx)).toBe(0)
  expect(legacyInstall.stdout.join('')).toContain(
    'Next: chox run proposed-workflow --dry-run'
  )
  expect(legacyInstall.stdout.join('')).not.toContain('--task-file')
})
