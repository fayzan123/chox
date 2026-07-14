import { spawn } from 'node:child_process'

import { ChoxError } from '../errors.js'
import { runCommand } from '../system/command.js'

export interface EngineOpts {
  timeoutMs?: number
  jsonSchema?: Record<string, unknown>
}

export interface EngineUsage {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface EngineStats {
  calls: number
  usage: EngineUsage
}

export interface AnalysisEngine {
  id: 'claude' | 'codex'
  model?: string
  analyze(digest: string, opts?: EngineOpts): Promise<unknown>
  stats(): EngineStats
}

interface EngineInvocation {
  binary: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  prompt: string
  timeoutMs: number
}

export interface EngineProcessResult {
  stdout: string
  stderr: string
  code: number
}

export async function runEngineProcess(invocation: EngineInvocation): Promise<EngineProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.binary, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      settled = true
      reject(new ChoxError(
        `${invocation.binary} analysis exceeded ${Math.ceil(invocation.timeoutMs / 1000)}s and was stopped.`
      ))
    }, invocation.timeoutMs)
    timer.unref()
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ChoxError(
        `${invocation.binary} is not available for analysis. Install or repair the CLI.`,
        1,
        { cause: error }
      ))
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? 1 })
    })
    child.stdin?.end(invocation.prompt)
  })
}

function candidateJson(text: string): unknown {
  const trimmed = text.trim()
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    return JSON.parse(unfenced) as unknown
  } catch {
    const first = unfenced.indexOf('{')
    const last = unfenced.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(unfenced.slice(first, last + 1)) as unknown
      } catch {
        // Throw the stable boundary error below.
      }
    }
  }
  throw new ChoxError('Analysis engine returned invalid JSON. Re-run with --no-confirm to inspect candidates.')
}

export function parseEngineJson(messages: string[]): unknown {
  const last = messages.map((value) => value.trim()).filter(Boolean).at(-1)
  if (!last) throw new ChoxError('Analysis engine returned no response. Re-run with --no-confirm to inspect candidates.')
  return candidateJson(last)
}

export function addUsage(total: EngineUsage, next: EngineUsage): void {
  for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens'] as const) {
    const value = next[key]
    if (value !== undefined) total[key] = (total[key] ?? 0) + value
  }
}

async function binaryPresent(binary: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const result = await runCommand(binary, ['--version'], {
    cwd: process.cwd(),
    env,
    allowFailure: true
  })
  return result.code === 0
}

export async function pickEngine(
  preference: 'claude' | 'codex' | undefined,
  env: NodeJS.ProcessEnv = process.env
): Promise<AnalysisEngine | undefined> {
  const order = preference ? [preference] : ['claude', 'codex'] as const
  for (const id of order) {
    if (!await binaryPresent(id, env)) continue
    if (id === 'claude') {
      const { createClaudeEngine } = await import('./claude.js')
      return createClaudeEngine(env)
    }
    const { createCodexEngine } = await import('./codex.js')
    return createCodexEngine(env)
  }
  return undefined
}
