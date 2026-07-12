import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

import type { CompiledHop } from '../artifacts/relay-compiler.js'
import type { Deviation } from './autonomy.js'

export interface GateIO {
  print(text: string): void
  readKey(prompt: string, allowed: string[]): Promise<string>
  openEditor(filePath: string): Promise<void>
  readLine(prompt: string): Promise<string>
}

export type GateOutcome =
  | { action: 'approve' }
  | { action: 'redirect', note: string }
  | { action: 'abort' }

export class RunInterruptedError extends Error {
  constructor() {
    super('Run interrupted')
    this.name = 'RunInterruptedError'
  }
}

export async function summarizeArtifact(path: string): Promise<string> {
  try {
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/)
    return lines.find((line) => /^#{1,6}\s+\S/.test(line))?.trim()
      ?? lines.find((line) => line.trim() !== '')?.trim()
      ?? '(empty)'
  } catch {
    return '(missing)'
  }
}

function renderGate(opts: {
  hop: CompiledHop
  artifactPaths: { name: string, path: string, summary: string }[]
  deviations: Deviation[]
  blocking: boolean
}): string {
  const lines = [`Gate after hop ${opts.hop.index + 1} (${opts.hop.role})`]
  if (opts.artifactPaths.length === 0) {
    lines.push('Artifacts: (none)')
  } else {
    lines.push('Artifacts:')
    for (const artifact of opts.artifactPaths) {
      lines.push(`  ${artifact.name} — ${artifact.summary}`, `    ${artifact.path}`)
    }
  }
  if (opts.deviations.length > 0) {
    lines.push('Deviations:')
    for (const deviation of [...opts.deviations].sort((left, right) => Number(left.advisory) - Number(right.advisory))) {
      lines.push(`  ${deviation.advisory ? '[advisory] ' : ''}${deviation.detail}`)
    }
  }
  lines.push(
    opts.blocking
      ? '[e]dit [r]edirect a[b]ort (approval blocked)'
      : '[a]pprove [e]dit [r]edirect a[b]ort'
  )
  return lines.join('\n')
}

async function selectArtifact(
  artifacts: { name: string, path: string, summary: string }[],
  io: GateIO
): Promise<{ name: string, path: string, summary: string } | undefined> {
  if (artifacts.length === 0) {
    io.print('There is no artifact to edit.')
    return undefined
  }
  if (artifacts.length === 1) return artifacts[0]
  const answer = (await io.readLine(
    `Artifact to edit (${artifacts.map((artifact, index) => `${index + 1}:${artifact.name}`).join(', ')}): `
  )).trim()
  const numeric = Number.parseInt(answer, 10)
  return artifacts[numeric - 1] ?? artifacts.find((artifact) => artifact.name === answer)
}

export async function presentGate(opts: {
  hop: CompiledHop
  artifactPaths: { name: string, path: string, summary: string }[]
  deviations: Deviation[]
  blocking: boolean
  io: GateIO
}): Promise<GateOutcome> {
  while (true) {
    opts.io.print(renderGate(opts))
    const allowed = opts.blocking ? ['e', 'r', 'b'] : ['a', 'e', 'r', 'b']
    const action = (await opts.io.readKey('Action: ', allowed)).toLowerCase()
    if (action === 'a' && !opts.blocking) return { action: 'approve' }
    if (action === 'b') return { action: 'abort' }
    if (action === 'r') {
      const note = await opts.io.readLine('Redirect note: ')
      return { action: 'redirect', note }
    }
    if (action === 'e') {
      const artifact = await selectArtifact(opts.artifactPaths, opts.io)
      if (!artifact) continue
      await opts.io.openEditor(artifact.path)
      artifact.summary = await summarizeArtifact(artifact.path)
    }
  }
}

function splitCommand(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  const input = value.trim()
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] as string
    if (character === '\\' && quote !== "'") {
      const next = input[index + 1]
      if (next && (next === '\\' || next === quote || (!quote && /\s/.test(next)))) {
        current += next
        index += 1
      } else {
        current += character
      }
    } else if (quote) {
      if (character === quote) quote = undefined
      else current += character
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (/\s/.test(character)) {
      if (current) {
        parts.push(current)
        current = ''
      }
    } else {
      current += character
    }
  }
  if (current) parts.push(current)
  return parts
}

export function createTerminalGateIO(env: NodeJS.ProcessEnv = process.env): GateIO {
  return {
    print(text) {
      process.stdout.write(`${text}\n`)
    },
    readKey(prompt, allowed) {
      return new Promise((resolve, reject) => {
        process.stdout.write(prompt)
        const input = process.stdin
        const restore = () => {
          input.off('data', onData)
          if (input.isTTY) input.setRawMode(false)
          process.stdout.write('\n')
        }
        const onData = (chunk: Buffer | string) => {
          const key = String(chunk).toLowerCase().slice(0, 1)
          if (key === '\u0003') {
            restore()
            reject(new RunInterruptedError())
          } else if (allowed.includes(key)) {
            restore()
            resolve(key)
          }
        }
        if (input.isTTY) input.setRawMode(true)
        input.resume()
        input.on('data', onData)
      })
    },
    async openEditor(filePath) {
      const editor = env.VISUAL?.trim() || env.EDITOR?.trim() || (process.platform === 'win32' ? 'notepad' : 'vi')
      const [command, ...args] = splitCommand(editor)
      if (!command) throw new Error('Editor command is empty')
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, [...args, filePath], { shell: false, stdio: 'inherit' })
        child.once('error', reject)
        child.once('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`Editor exited with code ${String(code)}`))
        })
      })
    },
    async readLine(prompt) {
      const lines = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await lines.question(prompt)
      } finally {
        lines.close()
      }
    }
  }
}
