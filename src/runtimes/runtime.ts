import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

import { claudeRuntime } from './claude.js'
import { codexRuntime } from './codex.js'

export interface RunOpts {
  cwd: string
  env?: NodeJS.ProcessEnv
}

export interface RuntimeProbe {
  present: boolean
  version?: string
  problem?: string
}

export type RuntimeEvent =
  | { kind: 'message', text: string }
  | { kind: 'command', command: string }
  | { kind: 'raw', line: string }

export interface AgentRuntime {
  id: string
  supportsSubagents: boolean
  preflight(): Promise<RuntimeProbe>
  spawnHeadless(invocation: string, opts: RunOpts): ChildProcess
  normalizeEvents(stdout: NodeJS.ReadableStream): AsyncIterable<RuntimeEvent>
}

export interface JsonLine {
  line: string
  value?: Record<string, unknown>
}

export async function* readJsonLines(stdout: NodeJS.ReadableStream): AsyncIterable<JsonLine> {
  const lines = createInterface({ input: stdout, crlfDelay: Infinity })
  for await (const line of lines) {
    try {
      const value = JSON.parse(line) as unknown
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        yield { line, value: value as Record<string, unknown> }
      } else {
        yield { line }
      }
    } catch {
      yield { line }
    }
  }
}

export async function probeBinary(
  binary: string,
  displayName: string,
  installUrl: string
): Promise<RuntimeProbe> {
  return new Promise((resolve) => {
    const child = spawn(binary, ['--version'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      output += String(chunk)
    })
    child.once('error', () => {
      resolve({
        present: false,
        problem: `${displayName} is not installed or not on PATH. Install it from ${installUrl}.`
      })
    })
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ present: true, version: output.trim() || 'version unknown' })
      } else {
        resolve({
          present: true,
          problem: `${displayName} was found, but '${binary} --version' exited ${String(code)}. Reinstall or repair it from ${installUrl}.`
        })
      }
    })
  })
}

export function getRuntime(id: string): AgentRuntime {
  if (id === 'claude') return claudeRuntime
  if (id === 'codex') return codexRuntime
  throw new Error(`Unknown runtime: ${id}`)
}
