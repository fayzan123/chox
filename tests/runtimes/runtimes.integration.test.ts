import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, test } from 'vitest'

import { claudeRuntime } from '../../src/runtimes/claude.js'
import { codexRuntime } from '../../src/runtimes/codex.js'
import type { AgentRuntime, RuntimeEvent } from '../../src/runtimes/runtime.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { installFakeAgents, setFakeAgentScript } from '../helpers/fake-agents.js'

afterEach(cleanupTempDirs)

async function collect(runtime: AgentRuntime, lines: string[]): Promise<RuntimeEvent[]> {
  const stream = Readable.from(lines.map((line) => `${line}\n`))
  const events: RuntimeEvent[] = []
  for await (const event of runtime.normalizeEvents(stream)) events.push(event)
  return events
}

describe.each([
  ['claude', claudeRuntime],
  ['codex', codexRuntime]
] as const)('%s runtime', (name, runtime) => {
  test('sends the prompt over stdin using an argv-array process', async () => {
    const root = await makeTempDir()
    const cwd = join(root, 'worktree with spaces')
    await mkdir(cwd)
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, { stdout: [] })

    const child = runtime.spawnHeadless('prompt with $HOME and "quotes"', {
      cwd,
      env: fake.env,
      model: 'model-pinned'
    })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })

    expect(exitCode).toBe(0)
    expect(await readFile(fake.stdinPath, 'utf8')).toBe('prompt with $HOME and "quotes"')
    const invocation = JSON.parse(await readFile(fake.argvPath, 'utf8')) as {
      binary: string
      args: string[]
    }
    expect(invocation.binary).toBe(name)
    expect(invocation.args).not.toContain('prompt with $HOME and "quotes"')
    expect(invocation.args).toContain('--model')
    expect(invocation.args).toContain('model-pinned')
  })

  test('opens an inherited-stdio native session with a positional prompt and native approvals', async () => {
    const root = await makeTempDir()
    const cwd = join(root, 'interactive worktree')
    await mkdir(cwd)
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, { stdout: [] })

    const child = runtime.spawnInteractive('interactive prompt', {
      cwd,
      env: fake.env,
      model: 'model-pinned'
    })
    expect(child.stdin).toBeNull()
    expect(child.stdout).toBeNull()
    expect(child.stderr).toBeNull()
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    expect(exitCode).toBe(0)

    const invocation = JSON.parse(await readFile(fake.argvPath, 'utf8')) as {
      binary: string
      args: string[]
    }
    expect(invocation.binary).toBe(name)
    expect(invocation.args).toContain('interactive prompt')
    expect(invocation.args).toContain('model-pinned')
    expect(invocation.args).not.toContain('--dangerously-skip-permissions')
    expect(invocation.args).not.toContain('--ask-for-approval')
    expect(invocation.args).not.toContain('exec')
  })
})

test('Claude normalizes messages and commands while preserving garbage and truncation', async () => {
  const events = await collect(claudeRuntime, [
    JSON.stringify({
      type: 'assistant',
      message: { content: [
        { type: 'text', text: 'working' },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }
      ] }
    }),
    'not json',
    '{"type":'
  ])
  expect(events).toEqual([
    { kind: 'message', text: 'working' },
    { kind: 'command', command: 'npm test' },
    { kind: 'raw', line: 'not json' },
    { kind: 'raw', line: '{"type":' }
  ])
})

test('Codex normalizes item events and keeps unknown JSON as raw', async () => {
  const command = JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', command: 'npm run build' }
  })
  const message = JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'done' }
  })
  const unknown = JSON.stringify({ type: 'future.event', value: 1 })
  expect(await collect(codexRuntime, [command, message, unknown])).toEqual([
    { kind: 'command', command: 'npm run build' },
    { kind: 'message', text: 'done' },
    { kind: 'raw', line: unknown }
  ])
})

test('Claude surfaces the actual session model and aggregate result usage', async () => {
  expect(await collect(claudeRuntime, [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-next' }),
    JSON.stringify({
      type: 'result',
      usage: {
        input_tokens: 11,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 3,
        output_tokens: 5
      }
    })
  ])).toEqual([
    { kind: 'session', model: 'claude-sonnet-next' },
    { kind: 'usage', inputTokens: 11, cachedInputTokens: 10, outputTokens: 5 }
  ])
})

test('Codex surfaces session metadata and turn token usage', async () => {
  expect(await collect(codexRuntime, [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-1', model: 'gpt-next-codex' }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25 }
    })
  ])).toEqual([
    { kind: 'session', model: 'gpt-next-codex' },
    { kind: 'usage', inputTokens: 100, cachedInputTokens: 40, outputTokens: 25 }
  ])
})

test('a missing runtime preflight is actionable and never exposes raw ENOENT', async () => {
  const priorPath = process.env.PATH
  const empty = await makeTempDir()
  process.env.PATH = empty
  try {
    const probe = await claudeRuntime.preflight()
    expect(probe.present).toBe(false)
    expect(probe.problem).toMatch(/Claude Code.*install/i)
    expect(probe.problem).not.toContain('ENOENT')
  } finally {
    process.env.PATH = priorPath
  }
})

test('a present binary whose version probe fails reports a repair action', async () => {
  const root = await makeTempDir()
  const fake = await installFakeAgents(root)
  const prior = { ...process.env }
  Object.assign(process.env, fake.env, { FAKE_VERSION_EXIT: '9' })
  try {
    const probe = await codexRuntime.preflight()
    expect(probe).toMatchObject({ present: true })
    expect(probe.problem).toMatch(/exited 9.*repair|repair.*exited 9/i)
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in prior)) delete process.env[key]
    }
    Object.assign(process.env, prior)
  }
})

test('production process launches never opt into shell command parsing', async () => {
  const sources = await Promise.all([
    readFile(new URL('../../src/runtimes/runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/runtimes/claude.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/runtimes/codex.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/harness/gates.ts', import.meta.url), 'utf8')
  ])
  expect(sources.join('\n')).not.toMatch(/shell:\s*true/)
})
