import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { runCli, type CliContext } from '../../bin/chox.js'
import { renderPlan, type ExecutionPlan } from '../../src/artifacts/relay-compiler.js'
import { RunInterruptedError, type GateIO } from '../../src/harness/gates.js'
import { resolvePaths } from '../../src/paths.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { initGitRepo } from '../helpers/git.js'
import { installFakeAgents, setFakeAgentScript } from '../helpers/fake-agents.js'

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

async function writeRelay(
  repoRoot: string,
  opts: { slug?: string, taskable?: boolean, hops?: number } = {}
): Promise<string> {
  const slug = opts.slug ?? 'taskable'
  const dir = join(repoRoot, '.chox', 'relays', slug)
  await mkdir(dir, { recursive: true })
  const hopCount = opts.hops ?? 1
  const hops = Array.from({ length: hopCount }, (_, index) => ({
    runtime: index % 2 === 0 ? 'claude' : 'codex',
    role: index === 0 ? 'plan' : 'implement',
    promptTemplate: `hop-${index + 1}.md`,
    autonomy: 'autonomous',
    interaction: 'headless',
    produces: [index === 0 ? 'spec.md' : 'result.md']
  }))
  await writeFile(join(dir, 'relay.json'), JSON.stringify({ slug, hops }))
  await writeFile(
    join(dir, 'hop-1.md'),
    opts.taskable === false ? 'Run the fixed workflow.' : 'Exact task follows:\n{{task}}'
  )
  if (hopCount > 1) {
    await writeFile(join(dir, 'hop-2.md'), 'Implement from {{artifact:spec.md}}')
  }
  return dir
}

function approvingGate(): GateIO {
  return {
    print() {},
    async readKey() { return 'a' },
    async openEditor() {},
    async readLine() { return '' }
  }
}

describe.sequential('run task input', () => {
  test('inline, relative-file, absolute-file, multiline, Unicode, and long tasks compile intact', async () => {
    const root = await makeTempDir()
    const repoRoot = await initGitRepo(root)
    await writeRelay(repoRoot)
    const env = { ...process.env, CHOX_HOME: join(root, 'chox-home') }
    const task = 'First line café 🚀\nSecond line {{repo}} {{mystery}} }{ "quoted" \\ slash'
    const relativePath = 'brief.md'
    await writeFile(join(repoRoot, relativePath), task)

    for (const args of [
      ['run', 'taskable', '--task', task, '--dry-run'],
      ['run', 'taskable', '--task-file', relativePath, '--dry-run'],
      ['run', 'taskable', '--task-file', resolve(repoRoot, relativePath), '--dry-run']
    ]) {
      const output = context({ cwd: repoRoot, env })
      expect(await runCli(args, output.ctx)).toBe(0)
      expect(output.stdout.join('')).toContain(task)
      expect(output.stdout.join('')).toContain('{{repo}} {{mystery}}')
      expect(output.stderr).toEqual([])
    }

    const longTask = 'x'.repeat(1024 * 1024)
    const long = context({ cwd: repoRoot, env })
    expect(await runCli(['run', 'taskable', '--task', longTask, '--dry-run'], long.ctx)).toBe(0)
    expect(long.stdout.join('')).toContain(longTask)
  })

  test('invalid task inputs and task/relay mismatches are usage errors before worktree creation', async () => {
    const root = await makeTempDir()
    const repoRoot = await initGitRepo(root)
    const taskableDir = await writeRelay(repoRoot)
    const fixedDir = await writeRelay(repoRoot, { slug: 'fixed', taskable: false })
    const choxHome = join(root, 'chox-home')
    const env = { ...process.env, CHOX_HOME: choxHome }
    const empty = join(repoRoot, 'empty.md')
    const whitespace = join(repoRoot, 'whitespace.md')
    const invalidUtf8 = join(repoRoot, 'invalid.md')
    const tooLarge = join(repoRoot, 'too-large.md')
    const unreadable = join(repoRoot, 'unreadable.md')
    await writeFile(empty, '')
    await writeFile(whitespace, '   \n')
    await writeFile(invalidUtf8, Buffer.from([0xc3, 0x28]))
    await writeFile(tooLarge, Buffer.alloc(1024 * 1024 + 1, 0x61))
    await writeFile(unreadable, 'secret')
    await chmod(unreadable, 0o000)

    const cases: Array<{ args: string[], expected: RegExp }> = [
      { args: ['run', 'taskable'], expected: /--task <text>.*--task-file <path>/ },
      { args: ['run', 'taskable', '--task', '   '], expected: /whitespace-only/ },
      { args: ['run', 'taskable', '--task-file', empty], expected: /whitespace-only/ },
      { args: ['run', 'taskable', '--task-file', whitespace], expected: /whitespace-only/ },
      { args: ['run', 'taskable', '--task-file', join(repoRoot, 'missing.md')], expected: /exists and is readable/ },
      { args: ['run', 'taskable', '--task-file', unreadable], expected: /exists and is readable/ },
      { args: ['run', 'taskable', '--task-file', invalidUtf8], expected: /valid UTF-8/ },
      { args: ['run', 'taskable', '--task-file', tooLarge], expected: /1 MiB.*1,048,576/ },
      { args: ['run', 'taskable', '--task', 'x'.repeat(1024 * 1024 + 1)], expected: /1 MiB.*1,048,576/ },
      { args: ['run', 'taskable', '--task', 'one', '--task-file', empty], expected: /mutually exclusive/ },
      { args: ['run', 'taskable', '--task', 'one', '--resume'], expected: /cannot be used with --resume/ },
      { args: ['run', 'taskable', '--task-file', empty, '--resume'], expected: /cannot be used with --resume/ },
      { args: ['run', 'fixed', '--task', 'must not be dropped'], expected: new RegExp(`does not consume[\\s\\S]*${fixedDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/]hop-1\\.md`) }
    ]

    for (const item of cases) {
      const output = context({ cwd: repoRoot, env })
      expect(await runCli(item.args, output.ctx)).toBe(2)
      expect(output.stderr.join('')).toMatch(item.expected)
    }
    await chmod(unreadable, 0o600)
    expect(taskableDir).toContain(join('.chox', 'relays', 'taskable'))
    await expect(readdir(resolvePaths(env).worktrees)).rejects.toThrow()
  })

  test('dry-run output is the rendered persisted real-run plan byte for byte', async () => {
    const root = await makeTempDir()
    const repoRoot = await initGitRepo(root)
    await writeRelay(repoRoot)
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, { artifacts: { 'spec.md': '# done\n' } })
    const task = 'JSON "quotes" \\ backslash\nUnicode λ and braces {{repo}}'
    await writeFile(join(repoRoot, 'task.md'), task)
    const env = { ...fake.env, CHOX_HOME: join(root, 'chox-home') }
    const dry = context({ cwd: repoRoot, env })
    expect(await runCli([
      'run', 'taskable', '--task-file', 'task.md', '--dry-run'
    ], dry.ctx)).toBe(0)

    const prior = { ...process.env }
    try {
      Object.assign(process.env, env)
      const real = context({ cwd: repoRoot, env })
      expect(await runCli([
        'run', 'taskable', '--task-file', 'task.md', '--unattended'
      ], real.ctx)).toBe(0)
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key]
      Object.assign(process.env, prior)
    }

    const [runId] = await readdir(join(env.CHOX_HOME as string, 'runs', 'taskable'))
    const plan = JSON.parse(await readFile(join(
      env.CHOX_HOME as string,
      'runs',
      'taskable',
      runId as string,
      'plan.json'
    ), 'utf8')) as ExecutionPlan
    expect(renderPlan(plan)).toBe(dry.stdout.join(''))
    expect(plan.hops[0]?.prompt).toContain(task)
  })

  test('a gate interruption resumes the persisted task plan without rereading the task file', async () => {
    const root = await makeTempDir()
    const repoRoot = await initGitRepo(root)
    const relayDir = await writeRelay(repoRoot, { hops: 2 })
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, { calls: [
      { artifacts: { 'spec.md': '# planned\n' } },
      { artifacts: { 'result.md': '# implemented\n' }, requireArtifacts: ['spec.md'] }
    ] })
    const task = 'ORIGINAL TASK {{repo}} café'
    const taskFile = join(repoRoot, 'task.md')
    await writeFile(taskFile, task)
    const env = { ...fake.env, CHOX_HOME: join(root, 'chox-home') }
    const prior = { ...process.env }
    try {
      Object.assign(process.env, env)
      const interruptedGate = approvingGate()
      interruptedGate.readKey = async () => { throw new RunInterruptedError() }
      const interrupted = context({
        cwd: repoRoot,
        env,
        stdinIsTTY: true,
        gateIO: interruptedGate
      })
      expect(await runCli([
        'run', 'taskable', '--task-file', taskFile
      ], interrupted.ctx)).toBe(130)

      await writeFile(taskFile, 'REPLACEMENT TASK MUST NOT APPEAR')
      await writeFile(join(relayDir, 'hop-1.md'), 'REPLACEMENT TEMPLATE MUST NOT APPEAR')
      const resumed = context({
        cwd: repoRoot,
        env,
        stdinIsTTY: true,
        gateIO: approvingGate()
      })
      expect(await runCli(['run', 'taskable', '--resume'], resumed.ctx)).toBe(0)
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key]
      Object.assign(process.env, prior)
    }

    const [runId] = await readdir(join(env.CHOX_HOME as string, 'runs', 'taskable'))
    const planText = await readFile(join(
      env.CHOX_HOME as string,
      'runs',
      'taskable',
      runId as string,
      'plan.json'
    ), 'utf8')
    expect(planText).toContain(task)
    expect(planText).not.toContain('REPLACEMENT TASK')
    expect(planText).not.toContain('REPLACEMENT TEMPLATE')
    const calls = (await readFile(fake.logPath, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as { stdin: string })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.stdin).toContain(task)
  })
})
