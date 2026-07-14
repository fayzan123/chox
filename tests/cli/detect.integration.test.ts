import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { runCli, type CliContext } from '../../bin/chox.js'
import { validateRelay } from '../../src/artifacts/ir.js'
import { resolvePaths } from '../../src/paths.js'
import { openSubstrate } from '../../src/substrate/store.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { installFakeAgents, setFakeAgentScript } from '../helpers/fake-agents.js'
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

function freshOutput(ctx: CliContext) {
  return context({ cwd: ctx.cwd, env: ctx.env, stdinIsTTY: ctx.stdinIsTTY })
}

const engineRelay = {
  confirmed: true,
  reason: 'A coherent repeated plan, implementation, and review workflow',
  relay: {
    slug: 'detected-plan-build-review',
    hops: [
      { runtime: 'claude', role: 'plan', autonomy: 'challenge', prompt: 'Plan the requested feature.' },
      { runtime: 'codex', role: 'implement', autonomy: 'challenge', prompt: 'Implement the persisted plan.' },
      { runtime: 'claude', role: 'review', autonomy: 'autonomous', prompt: 'Review the implementation.' }
    ]
  }
}

async function writeClaudeSession(
  home: string,
  repo: string,
  name: string,
  startedAt: string,
  endedAt: string,
  prompt: string,
  cwd = repo
): Promise<void> {
  const dir = join(home, '.claude', 'projects', 'fixture-project')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.jsonl`), [
    JSON.stringify({
      type: 'user', timestamp: startedAt, cwd,
      message: { role: 'user', content: prompt }
    }),
    JSON.stringify({
      type: 'assistant', timestamp: endedAt, cwd,
      message: { role: 'assistant', content: 'Completed.' }
    })
  ].join('\n'))
}

async function writeCodexSession(
  home: string,
  repo: string,
  name: string,
  startedAt: string,
  endedAt: string,
  prompt: string,
  cwd = repo
): Promise<void> {
  const dir = join(home, '.codex', 'sessions', '2026', '01', '01')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.jsonl`), [
    JSON.stringify({
      type: 'session_meta', timestamp: startedAt,
      payload: { cwd, originator: 'codex_vscode', source: 'vscode' }
    }),
    JSON.stringify({
      type: 'response_item', timestamp: startedAt,
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }
    }),
    JSON.stringify({
      type: 'response_item', timestamp: endedAt,
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Completed.' }] }
    })
  ].join('\n'))
}

async function writeLoop(home: string, repo: string, prefix = 'loop'): Promise<void> {
  await writeClaudeSession(
    home, repo, `${prefix}-plan`,
    '2026-01-01T10:00:00.000Z', '2026-01-01T10:20:00.000Z',
    'Plan alpha architecture and acceptance criteria'
  )
  await writeCodexSession(
    home, repo, `${prefix}-build`,
    '2026-01-01T11:00:00.000Z', '2026-01-01T11:30:00.000Z',
    'Implement beta changes from the specification'
  )
  await writeClaudeSession(
    home, repo, `${prefix}-review`,
    '2026-01-01T12:00:00.000Z', '2026-01-01T12:10:00.000Z',
    'Review gamma implementation against requirements'
  )
}

async function writeInstalledRelay(
  baseDir: string,
  slug: string,
  runtimes: Array<'claude' | 'codex'>
): Promise<void> {
  const dir = join(baseDir, slug)
  await mkdir(dir, { recursive: true })
  const hops = runtimes.map((runtime, index) => ({
    runtime,
    role: `role-${index + 1}`,
    promptTemplate: `hop-${index + 1}.md`,
    autonomy: 'autonomous',
    produces: [`artifact-${index + 1}.md`]
  }))
  await writeFile(join(dir, 'relay.json'), JSON.stringify({ slug, hops }))
  await Promise.all(hops.map(async (hop, index) => {
    await writeFile(join(dir, hop.promptTemplate), `Prompt ${index + 1}`)
  }))
}

async function detectionFixture() {
  const root = await makeTempDir()
  const repo = await initGitRepo(root)
  const home = join(root, 'user-home')
  const choxHome = join(root, 'chox-home')
  await writeLoop(home, repo)
  const fake = await installFakeAgents(root)
  await setFakeAgentScript(fake.scriptPath, {
    stdout: [{
      type: 'result',
      subtype: 'success',
      structured_output: engineRelay,
      usage: { input_tokens: 100, output_tokens: 20 }
    }]
  })
  const output = context({
    cwd: repo,
    env: { ...fake.env, HOME: home, USERPROFILE: home, CHOX_HOME: choxHome }
  })
  return { root, repo, home, choxHome, fake, output }
}

test('detect JSON has stable fields, confirms a finding, and status reads substrate stats', async () => {
  const fixture = await detectionFixture()
  fixture.output.ctx.env.ANTHROPIC_MODEL = 'sonnet'
  expect(await runCli(['detect', '--json', '--engine', 'claude'], fixture.output.ctx)).toBe(0)
  expect(fixture.output.stderr.join('')).toMatch(
    /Confirmation engine: claude; model: sonnet; ceiling: 3 calls per finding/
  )
  const result = JSON.parse(fixture.output.stdout.join('')) as {
    schemaVersion: number
    scan: { totalSessions: number, sessionsBySource: Record<string, number> }
    engine: { id: string, model: string, calls: number, usage: Record<string, number> }
    findings: Array<{ id: string, state: string, chain: string[], evidence: unknown }>
    failures: unknown[]
  }
  expect(Object.keys(result).sort()).toEqual(['engine', 'failures', 'findings', 'scan', 'schemaVersion'])
  expect(result.schemaVersion).toBe(1)
  expect(result.scan).toMatchObject({
    totalSessions: 3,
    sessionsBySource: { 'claude-code': 2, codex: 1 }
  })
  expect(result.engine).toMatchObject({
    id: 'claude', model: 'sonnet', calls: 1,
    usage: { inputTokens: 100, outputTokens: 20 }
  })
  expect(result.findings).toHaveLength(1)
  expect(result.findings[0]).toMatchObject({
    state: 'confirmed',
    chain: ['claude-code', 'codex', 'claude-code']
  })
  expect(result.failures).toEqual([])

  const status = freshOutput(fixture.output.ctx)
  expect(await runCli(['status'], status.ctx)).toBe(0)
  expect(status.stdout.join('')).toMatch(/Substrate:[\s\S]*claude-code 2, codex 1[\s\S]*1 suggested/)
})

test('--model reaches the selected engine and remains visible without corrupting JSON stdout', async () => {
  const fixture = await detectionFixture()
  expect(await runCli([
    'detect', '--json', '--engine', 'claude', '--model', 'fake-sonnet'
  ], fixture.output.ctx)).toBe(0)

  const invocation = JSON.parse(await readFile(fixture.fake.argvPath, 'utf8')) as { args: string[] }
  expect(invocation.args.slice(invocation.args.indexOf('--model'), invocation.args.indexOf('--model') + 2))
    .toEqual(['--model', 'fake-sonnet'])
  expect(fixture.output.stderr.join('')).toContain('model: fake-sonnet')
  const parsed = JSON.parse(fixture.output.stdout.join('')) as { engine: { model: string } }
  expect(parsed.engine.model).toBe('fake-sonnet')

  const invalid = freshOutput(fixture.output.ctx)
  expect(await runCli(['detect', '--model', '   '], invalid.ctx)).toBe(2)
  expect(invalid.stderr.join('')).toContain('--model requires a model name')
})

test('confirmation progress uses stdout for humans and stderr for JSON', async () => {
  const human = await detectionFixture()
  expect(await runCli(['detect', '--engine', 'claude'], human.output.ctx)).toBe(0)
  expect(human.output.stdout.join('')).toContain(
    'confirming 1/1: claude-code→codex→claude-code … call 1'
  )
  expect(human.output.stdout.join('')).toMatch(/confirmed 1\/1: handoff-[0-9a-f]{16} \(\d+ call\(s\), \d+s\)/)

  const machine = await detectionFixture()
  expect(await runCli(['detect', '--json', '--engine', 'claude'], machine.output.ctx)).toBe(0)
  expect(() => JSON.parse(machine.output.stdout.join(''))).not.toThrow()
  expect(machine.output.stdout.join('')).not.toContain('confirming 1/1:')
  expect(machine.output.stderr.join('')).toContain(
    'confirming 1/1: claude-code→codex→claude-code … call 1'
  )
})

test('detect excludes Chox-worktree sessions and reports the exclusion count', async () => {
  const fixture = await detectionFixture()
  const worktree = join(fixture.choxHome, 'worktrees', 'relay-run')
  await mkdir(worktree, { recursive: true })
  await writeClaudeSession(
    fixture.home, fixture.repo, 'tool-plan',
    '2026-01-01T13:00:00.000Z', '2026-01-01T13:10:00.000Z',
    'Tool invoked plan', worktree
  )
  await writeCodexSession(
    fixture.home, fixture.repo, 'tool-build',
    '2026-01-01T14:00:00.000Z', '2026-01-01T14:10:00.000Z',
    'Tool invoked build', worktree
  )

  expect(await runCli(['detect', '--no-confirm', '--json'], fixture.output.ctx)).toBe(0)
  const result = JSON.parse(fixture.output.stdout.join('')) as {
    scan: { toolInvokedSessions: number }
    findings: Array<{ chain: string[] }>
  }
  expect(result.scan.toolInvokedSessions).toBeGreaterThanOrEqual(2)
  expect(result.findings.map(({ chain }) => chain)).toEqual([
    ['claude-code', 'codex', 'claude-code']
  ])

  const human = freshOutput(fixture.output.ctx)
  expect(await runCli(['detect', '--no-confirm'], human.ctx)).toBe(0)
  expect(human.stdout.join('')).toContain('tool-invoked session(s) excluded')
})

test('an installed matching relay reports coverage and spends no analysis calls', async () => {
  const fixture = await detectionFixture()
  await writeInstalledRelay(
    join(fixture.choxHome, 'relays'),
    'spec-implement-review',
    ['claude', 'codex', 'claude']
  )

  expect(await runCli(['detect', '--json'], fixture.output.ctx)).toBe(0)
  const result = JSON.parse(fixture.output.stdout.join('')) as {
    engine: unknown
    findings: Array<{ state: string, coveredBy?: string }>
  }
  expect(result.engine).toBeNull()
  expect(result.findings).toEqual([
    expect.objectContaining({ state: 'covered', coveredBy: 'spec-implement-review' })
  ])
  await expect(access(fixture.fake.logPath)).rejects.toThrow()

  const human = freshOutput(fixture.output.ctx)
  expect(await runCli(['detect'], human.ctx)).toBe(0)
  expect(human.stdout.join('')).toContain('already automated by `spec-implement-review`')
})

test('--no-confirm spawns no engine and labels candidates unconfirmed', async () => {
  const fixture = await detectionFixture()
  expect(await runCli(['detect', '--no-confirm'], fixture.output.ctx)).toBe(0)
  const text = fixture.output.stdout.join('')
  expect(text).toMatch(/skipped by --no-confirm/i)
  expect(text).toMatch(/\[unconfirmed\]/)
  await expect(access(fixture.fake.logPath)).rejects.toThrow()
})

test('missing analysis binaries produce actionable unconfirmed candidates', async () => {
  const fixture = await detectionFixture()
  fixture.output.ctx.env.PATH = join(fixture.root, 'no-agent-binaries')

  expect(await runCli(['detect'], fixture.output.ctx)).toBe(0)
  const text = fixture.output.stdout.join('')
  expect(text).toMatch(/No analysis engine is available.*Install Claude Code or Codex CLI/i)
  expect(text).toContain('[unconfirmed]')
  await expect(access(fixture.fake.logPath)).rejects.toThrow()
})

test('an engine-rejected candidate is not mislabeled as unconfirmed', async () => {
  const fixture = await detectionFixture()
  await setFakeAgentScript(fixture.fake.scriptPath, {
    stdout: [{
      type: 'result',
      subtype: 'success',
      structured_output: { confirmed: false, reason: 'Temporal coincidence', relay: null },
      usage: { input_tokens: 40, output_tokens: 5 }
    }]
  })

  expect(await runCli(['detect', '--engine', 'claude'], fixture.output.ctx)).toBe(0)
  const text = fixture.output.stdout.join('')
  expect(text).toMatch(/No relay findings were confirmed.*1 candidate/i)
  expect(text).not.toContain('[unconfirmed]')
  expect(text).toMatch(/Engine spend: 1 call/)
})

test('a drafting failure remains a candidate instead of an uninstallable relay finding', async () => {
  const fixture = await detectionFixture()
  await setFakeAgentScript(fixture.fake.scriptPath, {
    stdout: [{
      type: 'result',
      result: JSON.stringify({
        confirmed: true,
        reason: 'Repeated handoff',
        relay: {}
      })
    }]
  })

  expect(await runCli(['detect', '--engine', 'claude'], fixture.output.ctx)).toBe(0)
  expect(fixture.output.stdout.join('')).toMatch(/confirmation\/drafting failed/i)
  const store = openSubstrate(resolvePaths(fixture.output.ctx.env))
  expect(store.listFindings({ kind: 'relay' })).toEqual([])
  expect(store.listFindings({ kind: 'handoff-candidate' })).toHaveLength(1)
  store.close()
})

test('honest no-findings output contains scanned counts, why, and what helps', async () => {
  const root = await makeTempDir()
  const home = join(root, 'user-home')
  await mkdir(join(home, '.claude', 'projects'), { recursive: true })
  await mkdir(join(home, '.codex', 'sessions'), { recursive: true })
  const output = context({
    cwd: root,
    env: { ...process.env, HOME: home, USERPROFILE: home, CHOX_HOME: join(root, 'chox-home') }
  })
  expect(await runCli(['detect', '--no-confirm'], output.ctx)).toBe(0)
  expect(output.stdout.join('')).toMatch(/Scanned 0 sessions[\s\S]*No relays[\s\S]*Why:[\s\S]*What helps:/)
})

test('--since limits reported sessions without making older watermarked sessions unrecoverable', async () => {
  const root = await makeTempDir()
  const home = join(root, 'user-home')
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CHOX_HOME: join(root, 'chox-home')
  }
  await writeClaudeSession(
    home, root, 'old',
    '2025-01-01T10:00:00.000Z', '2025-01-01T10:10:00.000Z',
    'Old planning session'
  )
  await writeClaudeSession(
    home, root, 'recent',
    '2026-07-12T10:00:00.000Z', '2026-07-12T10:10:00.000Z',
    'Recent planning session'
  )

  const limited = context({ cwd: root, env })
  expect(await runCli([
    'detect', '--source', 'claude-code', '--since', '30d', '--no-confirm', '--json'
  ], limited.ctx)).toBe(0)
  expect(JSON.parse(limited.stdout.join(''))).toMatchObject({
    scan: { totalSessions: 1, sessionsBySource: { 'claude-code': 1 } }
  })

  const complete = context({ cwd: root, env })
  expect(await runCli([
    'detect', '--source', 'claude-code', '--no-confirm', '--json'
  ], complete.ctx)).toBe(0)
  expect(JSON.parse(complete.stdout.join(''))).toMatchObject({
    scan: { totalSessions: 2, sessionsBySource: { 'claude-code': 2 } }
  })
})

test('install is repo-local, never overwrites a collision, and dismiss persists', async () => {
  const fixture = await detectionFixture()
  expect(await runCli(['detect', '--json'], fixture.output.ctx)).toBe(0)
  const result = JSON.parse(fixture.output.stdout.join('')) as { findings: Array<{ id: string }> }
  const findingId = result.findings[0]?.id
  expect(findingId).toBeDefined()
  const collision = join(fixture.repo, '.chox', 'relays', engineRelay.relay.slug)
  await mkdir(collision, { recursive: true })
  await writeFile(join(collision, 'hand-authored.txt'), 'keep me')

  const install = freshOutput(fixture.output.ctx)
  expect(await runCli(['install', findingId as string], install.ctx)).toBe(0)
  expect(install.stdout.join('')).toContain(`${engineRelay.relay.slug}-2`)
  expect(await readFile(join(collision, 'hand-authored.txt'), 'utf8')).toBe('keep me')
  const installed = join(fixture.repo, '.chox', 'relays', `${engineRelay.relay.slug}-2`)
  const relay = JSON.parse(await readFile(join(installed, 'relay.json'), 'utf8')) as Record<string, unknown>
  expect(relay).toMatchObject({
    slug: `${engineRelay.relay.slug}-2`,
    generatedBy: 'chox@0.0.0',
    finding: findingId
  })
  validateRelay(relay, { slug: `${engineRelay.relay.slug}-2` })
  expect(await readFile(join(installed, 'plan.md'), 'utf8')).toMatch(/generatedBy: chox@0\.0\.0/)

  const store = openSubstrate(resolvePaths(fixture.output.ctx.env))
  expect(store.getFinding(findingId as string)?.status).toBe('exported')
  store.close()
  const dismiss = freshOutput(fixture.output.ctx)
  expect(await runCli(['install', '--dismiss', findingId as string], dismiss.ctx)).toBe(0)
  const dismissedStore = openSubstrate(resolvePaths(fixture.output.ctx.env))
  expect(dismissedStore.getFinding(findingId as string)?.status).toBe('dismissed')
  dismissedStore.close()
})

test('usage errors cover future lenses, invalid since, invalid engine, and empty model values', async () => {
  for (const args of [
    ['detect', '--lens', 'profile'],
    ['detect', '--lens', 'repetition'],
    ['detect', '--since', 'soon'],
    ['detect', '--engine', 'future'],
    ['detect', '--model', '   ']
  ]) {
    const output = context()
    expect(await runCli(args, output.ctx)).toBe(2)
    expect(output.stderr.join('')).toMatch(/Phase|since|engine|model/i)
  }
})

test('demo-gate rehearsal confirms and validates a relay from three shared repos', async () => {
  const root = await makeTempDir()
  const home = join(root, 'user-home')
  const choxHome = join(root, 'chox-home')
  let cwd = root
  for (let index = 0; index < 3; index += 1) {
    const repoRoot = join(root, `repo-${index}`)
    await mkdir(repoRoot)
    // Separate each repo's files while retaining the same hour-level chain shape.
    const repoHome = join(home, `staging-${index}`)
    await writeLoop(repoHome, repoRoot, `repo-${index}`)
    const claudeSource = join(repoHome, '.claude', 'projects', 'fixture-project')
    const codexSource = join(repoHome, '.codex', 'sessions', '2026', '01', '01')
    const claudeTarget = join(home, '.claude', 'projects', `repo-${index}`)
    const codexTarget = join(home, '.codex', 'sessions', '2026', '01', `0${index + 1}`)
    await mkdir(claudeTarget, { recursive: true })
    await mkdir(codexTarget, { recursive: true })
    for (const name of [`repo-${index}-plan.jsonl`, `repo-${index}-review.jsonl`]) {
      await writeFile(join(claudeTarget, name), await readFile(join(claudeSource, name), 'utf8'))
    }
    await writeFile(
      join(codexTarget, `repo-${index}-build.jsonl`),
      await readFile(join(codexSource, `repo-${index}-build.jsonl`), 'utf8')
    )
    cwd = repoRoot
  }
  const fake = await installFakeAgents(root)
  await setFakeAgentScript(fake.scriptPath, {
    stdout: [{ type: 'result', subtype: 'success', structured_output: engineRelay }]
  })
  const output = context({
    cwd,
    env: { ...fake.env, HOME: home, USERPROFILE: home, CHOX_HOME: choxHome }
  })
  await writeInstalledRelay(
    join(choxHome, 'relays'),
    'spec-implement-review',
    ['claude', 'codex', 'claude']
  )
  expect(await runCli(['detect', '--json'], output.ctx)).toBe(0)
  const result = JSON.parse(output.stdout.join('')) as {
    findings: Array<{ id: string, state: string, coveredBy?: string }>
  }
  expect(result.findings.some(({ state, coveredBy }) => (
    state === 'covered' && coveredBy === 'spec-implement-review'
  ))).toBe(true)
  await expect(access(fake.logPath)).rejects.toThrow()
  const store = openSubstrate(resolvePaths(output.ctx.env))
  const stored = store.getFinding(result.findings[0]?.id ?? '')
  expect(stored?.payload).toMatchObject({
    coveredBy: 'spec-implement-review'
  })
  store.close()
})
