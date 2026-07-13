import { readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { createInterface } from 'node:readline/promises'

import type { CompiledHop } from '../artifacts/relay-compiler.js'
import type { Deviation, FootprintChange } from './autonomy.js'

export interface GateArtifact {
  name: string
  path: string
  relativePath?: string
  summary: string
}

export interface GateIO {
  print(text: string): void
  readKey(prompt: string, allowed: string[]): Promise<string>
  openEditor(filePath: string): Promise<void>
  readLine(prompt: string): Promise<string>
  isTTY?: boolean
  progress?(text: string, transient: boolean): void
  clearProgress?(): void
  release?(): void
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

function truncate(value: string, max = 80): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function manifestSummary(value: unknown): string | undefined {
  const manifest = record(value)
  const files = record(manifest?.files)
  if (!files) return undefined
  const create = Array.isArray(files.create) ? files.create.length : undefined
  const modify = Array.isArray(files.modify) ? files.modify.length : undefined
  const remove = Array.isArray(files.delete) ? files.delete.length : undefined
  const commands = Array.isArray(manifest?.commands) ? manifest.commands.length : undefined
  if ([create, modify, remove, commands].some((count) => count === undefined)) return undefined
  return `${String(create)} create, ${String(modify)} modify, ${String(remove)} delete, ${String(commands)} commands`
}

export async function summarizeArtifact(path: string): Promise<string> {
  try {
    const contents = await readFile(path, 'utf8')
    if (basename(path) === 'manifest.json') {
      try {
        const summary = manifestSummary(JSON.parse(contents) as unknown)
        if (summary) return summary
      } catch {
        // A malformed manifest still gets the safe generic JSON summary below.
      }
    }
    if (path.toLowerCase().endsWith('.json')) {
      return `${(await stat(path)).size} bytes`
    }
    const lines = contents.split(/\r?\n/)
    const summary = lines.find((line) => /^#{1,6}\s+\S/.test(line))?.trim()
      ?? lines.find((line) => line.trim() !== '')?.trim()
      ?? '(empty)'
    return truncate(summary)
  } catch {
    return '(missing)'
  }
}

export function summarizeFootprint(
  changes: FootprintChange[],
  heading = 'Files changed this hop',
  cap = 10
): string {
  if (changes.length === 0) return `${heading}: none`
  const order: Array<FootprintChange['operation']> = ['modify', 'create', 'delete']
  const labels: Record<FootprintChange['operation'], string> = {
    create: 'created',
    modify: 'modified',
    delete: 'deleted'
  }
  let remainingSlots = cap
  const parts: string[] = []
  for (const operation of order) {
    const paths = changes
      .filter((change) => change.operation === operation)
      .map((change) => change.path)
      .sort()
    if (paths.length === 0) continue
    const visible = paths.slice(0, remainingSlots)
    remainingSlots = Math.max(0, remainingSlots - visible.length)
    parts.push(
      `${paths.length} ${labels[operation]}`
      + (visible.length > 0 ? ` (${visible.join(', ')})` : '')
    )
  }
  const hidden = Math.max(0, changes.length - cap)
  return `${heading}: ${parts.join(', ')}${hidden > 0 ? `, +${hidden} more` : ''}`
}

function displayDetail(detail: string, worktree?: string): string {
  if (!worktree) return detail
  const normalized = worktree.replaceAll('\\', '/')
  return detail
    .replaceAll(`${worktree}/`, '')
    .replaceAll(`${worktree}\\`, '')
    .replaceAll(`${normalized}/`, '')
}

function renderGate(opts: {
  hop: CompiledHop
  artifactPaths: GateArtifact[]
  deviations: Deviation[]
  blocking: boolean
  footprint: FootprintChange[]
  worktree?: string
}): string {
  const lines = [`Gate after hop ${opts.hop.index + 1} (${opts.hop.role})`]
  if (opts.artifactPaths.length === 0) {
    lines.push('Artifacts: (none)')
  } else {
    lines.push('Artifacts:')
    for (const artifact of opts.artifactPaths) {
      lines.push(
        `  ${artifact.name} — ${artifact.summary}`,
        `    ${artifact.relativePath ?? artifact.path}`
      )
    }
  }
  lines.push(summarizeFootprint(opts.footprint))
  if (opts.deviations.length > 0) {
    lines.push('Deviations:')
    const blocking = opts.deviations.filter((deviation) => !deviation.advisory)
    const advisory = opts.deviations.filter((deviation) => deviation.advisory)
    for (const deviation of blocking) {
      lines.push(`  ${displayDetail(deviation.detail, opts.worktree)}`)
    }
    for (const deviation of advisory.slice(0, 2)) {
      lines.push(`  [advisory] ${displayDetail(deviation.detail, opts.worktree)}`)
    }
    if (advisory.length > 2) {
      lines.push(`  …and ${advisory.length - 2} more advisory command observations — full list in events.jsonl`)
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
  artifacts: GateArtifact[],
  io: GateIO
): Promise<GateArtifact | undefined> {
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
  artifactPaths: GateArtifact[]
  deviations: Deviation[]
  blocking: boolean
  footprint?: FootprintChange[]
  worktree?: string
  io: GateIO
}): Promise<GateOutcome> {
  while (true) {
    opts.io.print(renderGate({ ...opts, footprint: opts.footprint ?? [] }))
    const allowed = opts.blocking ? ['e', 'r', 'b'] : ['a', 'e', 'r', 'b']
    const action = (await opts.io.readKey('Action: ', allowed)).toLowerCase().slice(0, 1)
    const names: Record<string, string> = {
      a: 'approve',
      e: 'edit',
      r: 'redirect',
      b: 'abort'
    }
    if (!(action in names)) {
      opts.io.print(`Action: ${action || '(empty)'} → invalid`)
      opts.io.print(`Choose ${allowed.join(', ')}.`)
      continue
    }
    opts.io.print(`Action: ${action} → ${names[action]}`)
    if (!allowed.includes(action)) {
      opts.io.print('Approval is blocked; choose edit, redirect, or abort.')
      continue
    }
    if (action === 'a' && !opts.blocking) return { action: 'approve' }
    if (action === 'b') return { action: 'abort' }
    if (action === 'r') {
      const note = await opts.io.readLine('Redirect note: ')
      return { action: 'redirect', note }
    }
    if (action === 'e') {
      const artifact = await selectArtifact(opts.artifactPaths, opts.io)
      if (!artifact) continue
      opts.io.print(`Opening ${artifact.relativePath ?? artifact.name} in $EDITOR…`)
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

interface GateInput extends NodeJS.ReadableStream {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
}

interface GateOutput extends NodeJS.WritableStream {
  isTTY?: boolean
}

export function createTerminalGateIO(
  env: NodeJS.ProcessEnv = process.env,
  streams: { input?: GateInput, output?: GateOutput } = {}
): GateIO {
  const input = streams.input ?? process.stdin
  const output = streams.output ?? process.stdout
  let activeCleanup: (() => void) | undefined
  let progressWidth = 0

  const clearProgress = () => {
    if (progressWidth === 0 || !output.isTTY) return
    output.write(`\r${' '.repeat(progressWidth)}\r`)
    progressWidth = 0
  }
  const release = () => {
    activeCleanup?.()
    activeCleanup = undefined
    try {
      if (input.isTTY && input.setRawMode) input.setRawMode(false)
    } finally {
      input.pause()
    }
  }

  return {
    isTTY: Boolean(output.isTTY),
    print(text) {
      clearProgress()
      output.write(`${text}\n`)
    },
    progress(text, transient) {
      if (!transient || !output.isTTY) {
        clearProgress()
        output.write(`${text}\n`)
        return
      }
      const width = Math.max(progressWidth, text.length)
      output.write(`\r${text.padEnd(width)}`)
      progressWidth = width
    },
    clearProgress,
    release,
    readKey(prompt, _allowed) {
      return new Promise((resolve, reject) => {
        clearProgress()
        output.write(prompt)
        let settled = false
        const restore = () => {
          input.off('data', onData)
          input.off('end', onEnd)
          input.off('error', onError)
          try {
            if (input.isTTY && input.setRawMode) input.setRawMode(false)
          } catch {
            // Listener removal and pausing still prevent a stuck process.
          }
          input.pause()
          if (activeCleanup === restore) activeCleanup = undefined
          output.write('\n')
        }
        const finish = (callback: () => void) => {
          if (settled) return
          settled = true
          restore()
          callback()
        }
        const onData = (chunk: Buffer | string) => {
          const key = String(chunk).toLowerCase().slice(0, 1)
          if (key === '\u0003') {
            finish(() => reject(new RunInterruptedError()))
          } else {
            finish(() => resolve(key))
          }
        }
        const onEnd = () => finish(() => reject(new RunInterruptedError()))
        const onError = (error: Error) => finish(() => reject(error))
        activeCleanup?.()
        activeCleanup = restore
        input.on('data', onData)
        input.once('end', onEnd)
        input.once('error', onError)
        try {
          if (input.isTTY && input.setRawMode) input.setRawMode(true)
          input.resume()
        } catch (error) {
          finish(() => reject(error))
        }
      })
    },
    async openEditor(filePath) {
      release()
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
      release()
      const lines = createInterface({ input, output })
      try {
        return await lines.question(prompt)
      } finally {
        lines.close()
        input.pause()
      }
    }
  }
}
