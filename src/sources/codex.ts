import { createHash } from 'node:crypto'
import { stat, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { intentDigest } from '../digest.js'
import {
  emptyDiagnostics,
  type ParsedSession,
  type SessionRef,
  type SessionSource,
  type SourceDiagnostics
} from './source.js'

export const choxCodexOriginators = new Set(['codex_exec'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function discoverJsonl(root: string): Promise<string[]> {
  const found: string[] = []
  async function visit(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(resolve(path))
    }
  }
  await visit(root)
  return found
}

function timestamp(value: unknown): string | undefined {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(messageText).filter(Boolean).join('\n')
  if (!isRecord(value)) return ''
  if (typeof value.text === 'string') return value.text
  if ('content' in value) return messageText(value.content)
  return ''
}

function sessionId(ref: string): string {
  return `codex-${createHash('sha256').update(ref).digest('hex').slice(0, 24)}`
}

async function repoRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  while (true) {
    try {
      await stat(join(current, '.git'))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(cwd)
      current = parent
    }
  }
}

function addUnknown(diagnostics: SourceDiagnostics, type: string): void {
  diagnostics.unknownTypes[type] = (diagnostics.unknownTypes[type] ?? 0) + 1
}

class CodexSource implements SessionSource {
  readonly id = 'codex'

  async discover(homeDir: string): Promise<SessionRef[]> {
    const files = await discoverJsonl(join(homeDir, '.codex', 'sessions'))
    return Promise.all(files.map(async (fileRef) => {
      const info = await stat(fileRef)
      return {
        sourceId: this.id,
        fileRef,
        mtime: Math.trunc(info.mtimeMs),
        size: info.size
      }
    }))
  }

  async parse(ref: SessionRef): Promise<ParsedSession> {
    const diagnostics = emptyDiagnostics()
    const lines = (await readFile(ref.fileRef, 'utf8')).split(/\r?\n/)
    const timestamps: string[] = []
    let cwd = ''
    let originator: string | undefined
    let sawSessionMeta = false
    let firstUserText = ''
    let firstUserAt: string | undefined

    for (const line of lines) {
      if (line.trim() === '') continue
      let value: unknown
      try {
        value = JSON.parse(line) as unknown
      } catch {
        if (!diagnostics.failedFiles.includes(ref.fileRef)) diagnostics.failedFiles.push(ref.fileRef)
        continue
      }
      if (value === null) {
        diagnostics.nullLines += 1
        continue
      }
      if (!isRecord(value)) {
        addUnknown(diagnostics, '<non-object>')
        continue
      }
      const type = typeof value.type === 'string' ? value.type : '<missing>'
      const at = timestamp(value.timestamp)
      if (at) timestamps.push(at)
      const payload = isRecord(value.payload) ? value.payload : undefined
      if (type === 'session_meta') {
        sawSessionMeta = true
        if (typeof payload?.cwd === 'string') cwd = payload.cwd
        if (typeof payload?.originator === 'string') originator = payload.originator
        const payloadAt = timestamp(payload?.timestamp)
        if (payloadAt) timestamps.push(payloadAt)
      } else if (type === 'response_item') {
        if (
          !firstUserText
          && payload?.type === 'message'
          && payload.role === 'user'
        ) {
          firstUserText = messageText(payload.content)
          firstUserAt = at
        }
      } else if (type === 'event_msg') {
        if (!firstUserText && payload?.type === 'user_message') {
          firstUserText = messageText(payload.message)
          firstUserAt = at
        }
      } else {
        addUnknown(diagnostics, type)
      }
    }

    if (!sawSessionMeta && !diagnostics.failedFiles.includes(ref.fileRef)) {
      diagnostics.failedFiles.push(ref.fileRef)
    }
    timestamps.sort()
    const fallback = new Date(0).toISOString()
    const startedAt = timestamps[0] ?? firstUserAt ?? fallback
    const endedAt = timestamps.at(-1) ?? firstUserAt ?? startedAt
    const resolvedCwd = cwd || dirname(ref.fileRef)
    const id = sessionId(ref.fileRef)
    return {
      meta: {
        id,
        cwd: resolvedCwd,
        repoRoot: await repoRoot(resolvedCwd),
        ...(originator ? { originator } : {}),
        startedAt,
        endedAt,
        metadata: {
          toolInvoked: originator ? choxCodexOriginators.has(originator) : false,
          nullLines: diagnostics.nullLines,
          unknownTypeCount: Object.values(diagnostics.unknownTypes).reduce((sum, count) => sum + count, 0)
        }
      },
      units: firstUserText
        ? [{
            id: `${id}:session`,
            startedAt: firstUserAt ?? startedAt,
            endedAt,
            intentDigest: intentDigest(firstUserText),
            metadata: {}
          }]
        : [],
      diagnostics
    }
  }
}

export const codexSource: SessionSource = new CodexSource()
