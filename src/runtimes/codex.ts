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
    const item = record(value?.item)
    if (value?.type === 'item.completed' || value?.type === 'item.updated') {
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        yield { kind: 'message', text: item.text }
        continue
      }
      if (item?.type === 'command_execution') {
        const command = Array.isArray(item.command)
          ? item.command.map(String).join(' ')
          : item.command
        if (typeof command === 'string') {
          yield { kind: 'command', command }
          continue
        }
      }
    }
    yield { kind: 'raw', line: input.line }
  }
}

class CodexRuntime implements AgentRuntime {
  readonly id = 'codex'
  readonly supportsSubagents = true

  preflight(): Promise<RuntimeProbe> {
    return probeBinary('codex', 'Codex CLI', 'https://developers.openai.com/codex/cli')
  }

  spawnHeadless(invocation: string, opts: RunOpts): ChildProcess {
    const child = spawn('codex', [
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

