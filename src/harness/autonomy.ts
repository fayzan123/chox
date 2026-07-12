import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CompiledHop } from '../artifacts/relay-compiler.js'
import { observedCommands, type RunEventWriter } from './run-events.js'
import { runGit } from './git.js'

export interface Deviation {
  kind: 'out-of-manifest-file' | 'unlisted-command' | 'missing-challenge-notes' | 'missing-artifact'
  advisory: boolean
  detail: string
}

export interface StrictManifest {
  files: {
    create: string[]
    modify: string[]
    delete: string[]
  }
  commands: string[]
}

interface FootprintEntry {
  status: string
  hash: string
}

export interface FootprintSnapshot {
  entries: Record<string, FootprintEntry>
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

async function contentHash(worktree: string, path: string): Promise<string> {
  try {
    return createHash('sha256').update(await readFile(join(worktree, path))).digest('hex')
  } catch {
    return '<missing>'
  }
}

export async function snapshotFootprint(worktree: string): Promise<FootprintSnapshot> {
  const result = await runGit(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const tokens = result.stdout.split('\0')
  const entries: Record<string, FootprintEntry> = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token || token.length < 4) continue
    const status = token.slice(0, 2)
    const path = normalizePath(token.slice(3))
    if (path === '.chox-run' || path.startsWith('.chox-run/')) {
      if (status.includes('R') || status.includes('C')) index += 1
      continue
    }
    entries[path] = { status, hash: await contentHash(worktree, path) }
    if (status.includes('R') || status.includes('C')) {
      const source = normalizePath(tokens[index + 1] ?? '')
      if (source && !source.startsWith('.chox-run/')) {
        entries[source] = { status: 'D ', hash: '<missing>' }
      }
      index += 1
    }
  }
  return { entries }
}

function sameEntry(left: FootprintEntry | undefined, right: FootprintEntry | undefined): boolean {
  return left?.status === right?.status && left?.hash === right?.hash
}

function footprintDelta(
  before: FootprintSnapshot,
  after: FootprintSnapshot
): Array<{ path: string, operation: keyof StrictManifest['files'] }> {
  const paths = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])
  const changes: Array<{ path: string, operation: keyof StrictManifest['files'] }> = []
  for (const path of [...paths].sort()) {
    const earlier = before.entries[path]
    const current = after.entries[path]
    if (sameEntry(earlier, current)) continue
    if (!current) {
      changes.push({ path, operation: earlier?.status === '??' || earlier?.status.includes('A') ? 'delete' : 'modify' })
    } else if (current.status === '??' || (!earlier && current.status.includes('A'))) {
      changes.push({ path, operation: 'create' })
    } else if (current.status.includes('D')) {
      changes.push({ path, operation: 'delete' })
    } else {
      changes.push({ path, operation: 'modify' })
    }
  }
  return changes
}

function commandAllowed(command: string, expected: string[]): boolean {
  const actual = command.trim()
  return expected.some((item) => {
    const listed = item.trim()
    return actual === listed || actual.startsWith(`${listed} `)
  })
}

const consumedCommands = new WeakMap<RunEventWriter, number>()

async function challengeNotesDeviation(worktree: string): Promise<Deviation | undefined> {
  try {
    const notes = await readFile(join(worktree, '.chox-run', 'challenge-notes.md'), 'utf8')
    if (notes.trim() !== '') return undefined
  } catch {
    // Converted to the same actionable deviation as an empty file.
  }
  return {
    kind: 'missing-challenge-notes',
    advisory: false,
    detail: '.chox-run/challenge-notes.md is missing or empty'
  }
}

export async function checkAutonomy(opts: {
  hop: CompiledHop
  worktree: string
  before: FootprintSnapshot
  manifest?: StrictManifest
  events: RunEventWriter
}): Promise<{ deviations: Deviation[], blocking: boolean, degradedToChallenge: boolean }> {
  const deviations: Deviation[] = []
  const degradedToChallenge = opts.hop.autonomy === 'strict' && opts.manifest === undefined
  const after = await snapshotFootprint(opts.worktree)

  if (opts.manifest && (opts.hop.autonomy === 'strict' || opts.hop.autonomy === 'autonomous')) {
    const allowed = {
      create: new Set(opts.manifest.files.create.map(normalizePath)),
      modify: new Set(opts.manifest.files.modify.map(normalizePath)),
      delete: new Set(opts.manifest.files.delete.map(normalizePath))
    }
    for (const change of footprintDelta(opts.before, after)) {
      if (!allowed[change.operation].has(change.path)) {
        deviations.push({
          kind: 'out-of-manifest-file',
          advisory: false,
          detail: `${change.operation} ${change.path} is outside the strict manifest`
        })
      }
    }
  }

  const allCommands = observedCommands(opts.events)
  const start = consumedCommands.get(opts.events) ?? 0
  const currentCommands = allCommands.slice(start)
  consumedCommands.set(opts.events, allCommands.length)
  if (opts.manifest && (opts.hop.autonomy === 'strict' || opts.hop.autonomy === 'autonomous')) {
    for (const command of currentCommands) {
      if (!commandAllowed(command, opts.manifest.commands)) {
        deviations.push({
          kind: 'unlisted-command',
          advisory: true,
          detail: `Observed command not listed in the manifest: ${command}`
        })
      }
    }
  }

  if (opts.hop.autonomy === 'challenge' || degradedToChallenge) {
    const deviation = await challengeNotesDeviation(opts.worktree)
    if (deviation) deviations.push(deviation)
  }

  for (const artifact of opts.hop.produces) {
    try {
      await access(join(opts.worktree, artifact))
    } catch {
      deviations.push({
        kind: 'missing-artifact',
        advisory: false,
        detail: `Declared artifact is missing: ${artifact}`
      })
    }
  }

  for (const deviation of deviations) {
    opts.events.append('deviation', { hop: opts.hop.index, deviation })
  }
  const blocking = opts.hop.autonomy !== 'autonomous'
    && deviations.some((deviation) => !deviation.advisory)
  return { deviations, blocking, degradedToChallenge }
}
