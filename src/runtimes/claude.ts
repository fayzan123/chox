import { spawn, type ChildProcess } from 'node:child_process'

import {
  probeBinary,
  readJsonLines,
  type AgentRuntime,
  type RunOpts,
  type RuntimeEvent,
  type RuntimeProbe
} from './runtime.js'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function* normalize(stdout: NodeJS.ReadableStream): AsyncIterable<RuntimeEvent> {
  for await (const input of readJsonLines(stdout)) {
    const value = input.value
    if (!value) {
      yield { kind: 'raw', line: input.line }
      continue
    }

    let recognized = false
    const message = record(value.message)
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

  spawnHeadless(invocation: string, opts: RunOpts): ChildProcess {
    const child = spawn('claude', [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions'
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

