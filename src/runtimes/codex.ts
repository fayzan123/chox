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
  const cachedInputTokens = tokenCount(usage.cached_input_tokens)
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

function sessionModel(value: Record<string, unknown>): string | undefined {
  if (typeof value.model === 'string') return value.model
  for (const key of ['thread', 'session']) {
    const nested = record(value[key])
    if (typeof nested?.model === 'string') return nested.model
  }
  return undefined
}

async function* normalize(stdout: NodeJS.ReadableStream): AsyncIterable<RuntimeEvent> {
  let reportedModel: string | undefined
  for await (const input of readJsonLines(stdout)) {
    const value = input.value
    let recognized = false
    if (value && typeof value.type === 'string' && /^(thread|session|turn)\.started$/.test(value.type)) {
      const model = sessionModel(value)
      if (model && model !== reportedModel) {
        recognized = true
        reportedModel = model
        yield { kind: 'session', model }
      }
    }
    if (value?.type === 'turn.completed' || value?.type === 'session.completed') {
      const usage = usageEvent(value.usage)
      if (usage) {
        recognized = true
        yield usage
      }
    }
    const item = record(value?.item)
    if (value?.type === 'item.completed' || value?.type === 'item.updated') {
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        recognized = true
        yield { kind: 'message', text: item.text }
      }
      if (item?.type === 'command_execution') {
        const command = Array.isArray(item.command)
          ? item.command.map(String).join(' ')
          : item.command
        if (typeof command === 'string') {
          recognized = true
          yield { kind: 'command', command }
        }
      }
    }
    if (!recognized) yield { kind: 'raw', line: input.line }
  }
}

class CodexRuntime implements AgentRuntime {
  readonly id = 'codex'
  readonly supportsSubagents = true

  preflight(): Promise<RuntimeProbe> {
    return probeBinary('codex', 'Codex CLI', 'https://developers.openai.com/codex/cli')
  }

  spawnInteractive(invocation: string, opts: RunOpts & { model?: string }): ChildProcess {
    return spawn('codex', [
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
    const child = spawn('codex', [
      ...(opts.model !== undefined ? ['--model', opts.model] : []),
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '-'
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

export const codexRuntime: AgentRuntime = new CodexRuntime()
