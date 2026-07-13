import { spawn, type ChildProcess } from 'node:child_process'

import {
  probeBinary,
  readJsonLines,
  type AgentRuntime,
  type RunOpts,
  type RuntimeEvent,
  type RuntimeProbe,
  type TokenUsage
} from './runtime.js'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function usageEvent(value: unknown): ({ kind: 'usage' } & TokenUsage) | undefined {
  const usage = record(value)
  if (!usage) return undefined
  const inputTokens = tokenCount(usage.input_tokens)
  const outputTokens = tokenCount(usage.output_tokens)
  const cacheRead = tokenCount(usage.cache_read_input_tokens)
  const cacheCreation = tokenCount(usage.cache_creation_input_tokens)
  const cachedInputTokens = cacheRead === undefined && cacheCreation === undefined
    ? undefined
    : (cacheRead ?? 0) + (cacheCreation ?? 0)
  const totalTokens = tokenCount(usage.total_tokens)
  if (
    inputTokens === undefined
    && outputTokens === undefined
    && cachedInputTokens === undefined
    && totalTokens === undefined
  ) return undefined
  return {
    kind: 'usage',
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  }
}

async function* normalize(stdout: NodeJS.ReadableStream): AsyncIterable<RuntimeEvent> {
  let reportedModel: string | undefined
  for await (const input of readJsonLines(stdout)) {
    const value = input.value
    if (!value) {
      yield { kind: 'raw', line: input.line }
      continue
    }

    let recognized = false
    const message = record(value.message)
    const model = typeof value.model === 'string'
      ? value.model
      : typeof message?.model === 'string'
        ? message.model
        : undefined
    if (model && model !== reportedModel && (value.type === 'system' || value.type === 'assistant')) {
      recognized = true
      reportedModel = model
      yield { kind: 'session', model }
    }
    const content = Array.isArray(message?.content) ? message.content : []
    for (const itemValue of content) {
      const item = record(itemValue)
      if (item?.type === 'text' && typeof item.text === 'string') {
        recognized = true
        yield { kind: 'message', text: item.text }
      }
      if (item?.type === 'tool_use') {
        const inputValue = record(item.input)
        if (typeof inputValue?.command === 'string') {
          recognized = true
          yield { kind: 'command', command: inputValue.command }
        }
      }
    }
    if (value.type === 'result' && typeof value.result === 'string') {
      recognized = true
      yield { kind: 'message', text: value.result }
    }
    if (value.type === 'result') {
      const usage = usageEvent(value.usage)
      if (usage) {
        recognized = true
        yield usage
      }
    }
    const delta = record(value.delta)
    if (typeof delta?.text === 'string') {
      recognized = true
      yield { kind: 'message', text: delta.text }
    }
    if (!recognized) yield { kind: 'raw', line: input.line }
  }
}

class ClaudeRuntime implements AgentRuntime {
  readonly id = 'claude'
  readonly supportsSubagents = true

  preflight(): Promise<RuntimeProbe> {
    return probeBinary('claude', 'Claude Code', 'https://docs.anthropic.com/en/docs/claude-code')
  }

  spawnInteractive(invocation: string, opts: RunOpts & { model?: string }): ChildProcess {
    return spawn('claude', [
      ...(opts.model !== undefined ? ['--model', opts.model] : []),
      invocation
    ], {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: 'inherit'
    })
  }

  spawnHeadless(invocation: string, opts: RunOpts & { model?: string }): ChildProcess {
    const child = spawn('claude', [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      ...(opts.model !== undefined ? ['--model', opts.model] : [])
    ], {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stdin?.end(invocation)
    return child
  }

  normalizeEvents(stdout: NodeJS.ReadableStream): AsyncIterable<RuntimeEvent> {
    return normalize(stdout)
  }
}

export const claudeRuntime: AgentRuntime = new ClaudeRuntime()
