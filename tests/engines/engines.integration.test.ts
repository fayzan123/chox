import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, test } from 'vitest'

import { createClaudeEngine } from '../../src/engines/claude.js'
import { createCodexEngine } from '../../src/engines/codex.js'
import { pickEngine } from '../../src/engines/engine.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { installFakeAgents, setFakeAgentScript } from '../helpers/fake-agents.js'

afterEach(cleanupTempDirs)

describe('analysis engines', () => {
  test('Claude parses defensive JSON and reports emitted usage', async () => {
    const root = await makeTempDir()
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, {
      stdout: [{
        type: 'result',
        result: '```json\n{"confirmed":true}\n```',
        usage: { input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 3 }
      }]
    })
    const engine = createClaudeEngine(fake.env)
    await expect(engine.analyze('private prompt')).resolves.toEqual({ confirmed: true })
    expect(engine.stats()).toEqual({
      calls: 1,
      usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 3 }
    })
    expect(await readFile(fake.stdinPath, 'utf8')).toBe('private prompt')
    const invocation = JSON.parse(await readFile(fake.argvPath, 'utf8')) as { args: string[] }
    expect(invocation.args).toContain('--tools')
    expect(invocation.args).not.toContain('private prompt')
  })

  test('Claude surfaces an environment-selected model and isolates analysis sessions', async () => {
    const root = await makeTempDir()
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, {
      stdout: [{ type: 'result', result: '{"confirmed":false}' }]
    })
    const engine = createClaudeEngine({ ...fake.env, ANTHROPIC_MODEL: 'sonnet' })

    expect(engine.model).toBe('sonnet')
    await engine.analyze('candidate')
    const invocation = JSON.parse(await readFile(fake.argvPath, 'utf8')) as { args: string[] }
    expect(invocation.args).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose',
      '--safe-mode', '--no-session-persistence', '--model', 'sonnet',
      '--tools', ''
    ])
  })

  test('an explicit Claude model overrides ANTHROPIC_MODEL', async () => {
    const root = await makeTempDir()
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, {
      stdout: [{ type: 'result', result: '{"confirmed":false}' }]
    })
    const engine = createClaudeEngine(
      { ...fake.env, ANTHROPIC_MODEL: 'environment-model' },
      { model: 'sonnet-test' }
    )

    expect(engine.model).toBe('sonnet-test')
    await engine.analyze('candidate')
    const invocation = JSON.parse(await readFile(fake.argvPath, 'utf8')) as { args: string[] }
    expect(invocation.args.slice(invocation.args.indexOf('--model'), invocation.args.indexOf('--model') + 2))
      .toEqual(['--model', 'sonnet-test'])
  })

  test('Claude requests and returns validated structured output when given a schema', async () => {
    const root = await makeTempDir()
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, {
      stdout: [{
        type: 'result',
        structured_output: { confirmed: false, reason: 'Coincidence', relay: null },
        usage: { input_tokens: 8, output_tokens: 2 }
      }]
    })
    const schema = {
      type: 'object',
      properties: { confirmed: { type: 'boolean' } },
      required: ['confirmed']
    }
    const engine = createClaudeEngine(fake.env)

    await expect(engine.analyze('candidate', { jsonSchema: schema })).resolves.toEqual({
      confirmed: false,
      reason: 'Coincidence',
      relay: null
    })
    expect(engine.stats().usage).toEqual({ inputTokens: 8, outputTokens: 2 })
    const invocation = JSON.parse(await readFile(fake.argvPath, 'utf8')) as { args: string[] }
    expect(invocation.args).toContain('--json-schema')
    expect(invocation.args).toContain(JSON.stringify(schema))
    expect(invocation.args.slice(invocation.args.indexOf('--output-format'), invocation.args.indexOf('--output-format') + 2))
      .toEqual(['--output-format', 'json'])
  })

  test('Codex parses agent JSON and reports emitted usage', async () => {
    const root = await makeTempDir()
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, {
      stdout: [
        { type: 'item.completed', item: { type: 'agent_message', text: '{"confirmed":false}' } },
        { type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 5, output_tokens: 2 } }
      ]
    })
    const engine = createCodexEngine(fake.env)
    await expect(engine.analyze('candidate')).resolves.toEqual({ confirmed: false })
    expect(engine.stats()).toEqual({
      calls: 1,
      usage: { inputTokens: 12, cachedInputTokens: 5, outputTokens: 2 }
    })
    const invocation = JSON.parse(await readFile(fake.argvPath, 'utf8')) as { args: string[] }
    expect(invocation.args).toEqual([
      '--sandbox', 'read-only', '--ask-for-approval', 'never', 'exec', '--json', '-'
    ])
    expect(engine.model).toBeUndefined()
    expect(invocation.args).not.toContain('-c')
  })

  test('Codex passes an explicit model config before the exec subcommand', async () => {
    const root = await makeTempDir()
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, {
      stdout: [{ type: 'item.completed', item: { type: 'agent_message', text: '{"confirmed":false}' } }]
    })
    const engine = createCodexEngine(fake.env, { model: 'gpt-test' })

    expect(engine.model).toBe('gpt-test')
    await engine.analyze('candidate')
    const invocation = JSON.parse(await readFile(fake.argvPath, 'utf8')) as { args: string[] }
    expect(invocation.args.slice(invocation.args.indexOf('-c'), invocation.args.indexOf('-c') + 2))
      .toEqual(['-c', 'model=gpt-test'])
    expect(invocation.args.indexOf('-c')).toBeLessThan(invocation.args.indexOf('exec'))
  })

  test('invalid engine output and timeout are clean finding-level failures', async () => {
    const root = await makeTempDir()
    const fake = await installFakeAgents(root)
    await setFakeAgentScript(fake.scriptPath, {
      stdout: [{ type: 'result', result: 'not json' }]
    })
    await expect(createClaudeEngine(fake.env).analyze('candidate')).rejects.toThrow(/invalid JSON/i)
    await setFakeAgentScript(fake.scriptPath, { delayMs: 100, stdout: [] })
    await expect(createCodexEngine(fake.env).analyze('candidate', { timeoutMs: 10 }))
      .rejects.toThrow(/exceeded.*stopped/i)
  })

  test('picks Claude first by default and honors an explicit preference', async () => {
    const root = await makeTempDir()
    const fake = await installFakeAgents(root)
    expect((await pickEngine(undefined, fake.env))?.id).toBe('claude')
    expect((await pickEngine('codex', fake.env))?.id).toBe('codex')
    expect((await pickEngine('codex', fake.env, { model: 'gpt-picked' }))?.model).toBe('gpt-picked')
  })
})
