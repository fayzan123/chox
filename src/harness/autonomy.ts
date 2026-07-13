import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CompiledHop } from '../artifacts/relay-compiler.js'
import { observedCommands, type RunEventWriter } from './run-events.js'
import { runGit } from '../system/command.js'

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
  head: string
  entries: Record<string, FootprintEntry>
}

export interface FootprintChange {
  path: string
  operation: keyof StrictManifest['files']
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

async function contentHash(worktree: string, path: string): Promise<string> {
  const result = await runGit(worktree, [
    'hash-object',
    `--path=${path}`,
    '--',
    path
  ], { allowFailure: true })
  return result.code === 0 && result.stdout.trim() !== ''
    ? result.stdout.trim()
    : '<missing>'
}

export async function snapshotFootprint(worktree: string): Promise<FootprintSnapshot> {
  const head = (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim()
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
  return { head, entries }
}

function parseNameStatus(output: string): FootprintChange[] {
  const tokens = output.split('\0')
  const changes = new Map<string, FootprintChange['operation']>()
  let index = 0
  while (index < tokens.length) {
    const status = tokens[index++]
    if (!status) continue
    const kind = status[0]
    if (kind === 'R' || kind === 'C') {
      const source = normalizePath(tokens[index++] ?? '')
      const destination = normalizePath(tokens[index++] ?? '')
      if (kind === 'R' && source && !isHarnessArtifact(source)) changes.set(source, 'delete')
      if (destination && !isHarnessArtifact(destination)) changes.set(destination, 'create')
      continue
    }
    const path = normalizePath(tokens[index++] ?? '')
    if (!path || isHarnessArtifact(path)) continue
    changes.set(path, kind === 'A' ? 'create' : kind === 'D' ? 'delete' : 'modify')
  }
  return [...changes.entries()].map(([path, operation]) => ({ path, operation }))
}

async function committedChanges(
  worktree: string,
  beforeHead: string,
  afterHead: string
): Promise<FootprintChange[]> {
  if (beforeHead === afterHead) return []
  const result = await runGit(worktree, [
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    beforeHead,
    afterHead,
    '--'
  ])
  return parseNameStatus(result.stdout)
}

async function blobAt(worktree: string, head: string, path: string): Promise<string> {
  const result = await runGit(worktree, [
    'ls-tree',
    '-z',
    head,
    '--',
    `:(literal)${path}`
  ], { allowFailure: true })
  if (result.code !== 0 || result.stdout === '') return '<missing>'
  const metadata = result.stdout.slice(0, result.stdout.indexOf('\t'))
  const fields = metadata.split(' ')
  return fields[2] ?? '<missing>'
}

export async function diffFootprints(
  worktree: string,
  before: FootprintSnapshot,
  after: FootprintSnapshot
): Promise<FootprintChange[]> {
  const dirtyPaths = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])
  const changes = new Map<string, FootprintChange['operation']>()
  await Promise.all([...dirtyPaths].map(async (path) => {
    const earlier = before.entries[path]
    const current = after.entries[path]
    const earlierHash = earlier?.hash ?? await blobAt(worktree, before.head, path)
    const currentHash = current?.hash ?? await blobAt(worktree, after.head, path)
    if (earlierHash === currentHash) {
      if (!earlier && current) changes.set(path, 'modify')
      else if (earlier && current && earlier.status !== current.status) changes.set(path, 'modify')
      return
    }
    changes.set(
      path,
      earlierHash === '<missing>' ? 'create' : currentHash === '<missing>' ? 'delete' : 'modify'
    )
  }))
  for (const change of await committedChanges(worktree, before.head, after.head)) {
    if (!dirtyPaths.has(change.path)) changes.set(change.path, change.operation)
  }
  return [...changes.entries()]
    .map(([path, operation]) => ({ path, operation }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function isHarnessArtifact(path: string): boolean {
  return path === '.chox-run' || path.startsWith('.chox-run/')
}

export async function diffFromBase(worktree: string, baseCommit: string): Promise<FootprintChange[]> {
  const result = await runGit(worktree, [
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    baseCommit,
    '--'
  ])
  const changes = new Map(parseNameStatus(result.stdout).map((change) => [
    change.path,
    change.operation
  ]))

  const untracked = await runGit(worktree, ['ls-files', '--others', '--exclude-standard', '-z'])
  for (const rawPath of untracked.stdout.split('\0')) {
    const path = normalizePath(rawPath)
    if (path && !isHarnessArtifact(path)) changes.set(path, 'create')
  }
  return [...changes.entries()]
    .map(([path, operation]) => ({ path, operation }))
    .sort((left, right) => left.path.localeCompare(right.path))
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
}): Promise<{
  deviations: Deviation[]
  blocking: boolean
  degradedToChallenge: boolean
  footprint: FootprintChange[]
}> {
  const deviations: Deviation[] = []
  const degradedToChallenge = opts.hop.autonomy === 'strict' && opts.manifest === undefined
  const after = await snapshotFootprint(opts.worktree)
  const footprint = await diffFootprints(opts.worktree, opts.before, after)

  if (opts.manifest && (opts.hop.autonomy === 'strict' || opts.hop.autonomy === 'autonomous')) {
    const allowed = {
      create: new Set(opts.manifest.files.create.map(normalizePath)),
      modify: new Set(opts.manifest.files.modify.map(normalizePath)),
      delete: new Set(opts.manifest.files.delete.map(normalizePath))
    }
    for (const change of footprint) {
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
  return { deviations, blocking, degradedToChallenge, footprint }
}
