import { readFile } from 'node:fs/promises'

import type { SubstrateStore } from '../substrate/store.js'
import { advanceWatermark, needsScan } from '../substrate/watermarks.js'

export interface SessionRef {
  sourceId: string
  fileRef: string
  mtime: number
  size: number
}

export interface SessionMeta {
  id: string
  cwd: string
  repoRoot: string
  originator?: string
  startedAt: string
  endedAt: string
  metadata: Record<string, unknown>
}

export interface TaskUnit {
  id: string
  startedAt: string
  endedAt: string
  intentDigest: string
  metadata: Record<string, unknown>
}

export interface SourceDiagnostics {
  unknownTypes: Record<string, number>
  nullLines: number
  failedFiles: string[]
}

export interface ParsedSession {
  meta: SessionMeta
  units: TaskUnit[]
  diagnostics: SourceDiagnostics
}

export interface SessionSource {
  id: string
  discover(homeDir: string): Promise<SessionRef[]>
  parse(ref: SessionRef): Promise<ParsedSession>
}

export interface SourceScanResult {
  sourceId: string
  discoveredFiles: number
  parsedFiles: number
  unchangedFiles: number
  sessionsStored: number
  diagnostics: SourceDiagnostics
}

export function emptyDiagnostics(): SourceDiagnostics {
  return { unknownTypes: {}, nullLines: 0, failedFiles: [] }
}

export function mergeDiagnostics(
  target: SourceDiagnostics,
  incoming: SourceDiagnostics
): void {
  target.nullLines += incoming.nullLines
  target.failedFiles.push(...incoming.failedFiles)
  for (const [type, count] of Object.entries(incoming.unknownTypes)) {
    target.unknownTypes[type] = (target.unknownTypes[type] ?? 0) + count
  }
}

export async function scanSessionSources(opts: {
  store: SubstrateStore
  sources: SessionSource[]
  homeDir: string
  since?: string
  now?: () => Date
}): Promise<SourceScanResult[]> {
  const results: SourceScanResult[] = []
  for (const source of opts.sources) {
    const diagnostics = emptyDiagnostics()
    let refs: SessionRef[]
    try {
      refs = await source.discover(opts.homeDir)
    } catch {
      refs = []
      diagnostics.failedFiles.push(`${source.id}: discovery failed`)
    }
    opts.store.upsertSource({
      id: source.id,
      kind: source.id,
      rootPath: opts.homeDir
    })
    let parsedFiles = 0
    let unchangedFiles = 0
    let sessionsStored = 0
    for (const ref of refs) {
      if (!needsScan(opts.store, source.id, ref.fileRef, ref)) {
        unchangedFiles += 1
        continue
      }
      try {
        const parsed = await source.parse(ref)
        parsedFiles += 1
        mergeDiagnostics(diagnostics, parsed.diagnostics)
        if (!opts.since || parsed.meta.endedAt >= opts.since) {
          opts.store.replaceSession(source.id, ref.fileRef, parsed)
          sessionsStored += 1
        }
        advanceWatermark(opts.store, source.id, ref.fileRef, ref)
      } catch {
        diagnostics.failedFiles.push(ref.fileRef)
      }
    }
    const scannedAt = (opts.now ?? (() => new Date()))().toISOString()
    opts.store.upsertSource({
      id: source.id,
      kind: source.id,
      rootPath: opts.homeDir,
      lastScanAt: scannedAt
    })
    results.push({
      sourceId: source.id,
      discoveredFiles: refs.length,
      parsedFiles,
      unchangedFiles,
      sessionsStored,
      diagnostics
    })
  }
  return results
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectText)
  if (!isRecord(value)) return []
  const text: string[] = []
  for (const [key, child] of Object.entries(value)) {
    if (key === 'text' || key === 'content' || key === 'message') {
      text.push(...collectText(child))
    }
  }
  return text
}

export async function readSessionExcerpt(
  sourceId: string,
  ref: string,
  maxChars = 4000
): Promise<string> {
  const lines = (await readFile(ref, 'utf8')).split(/\r?\n/)
  const excerpts: string[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      continue
    }
    if (!isRecord(value)) continue
    if (sourceId === 'claude-code' && (value.type === 'user' || value.type === 'assistant')) {
      const message = isRecord(value.message) ? value.message : undefined
      excerpts.push(...collectText(message?.content))
    }
    if (sourceId === 'codex' && value.type === 'response_item') {
      const payload = isRecord(value.payload) ? value.payload : undefined
      if (payload?.type === 'message') excerpts.push(...collectText(payload.content))
    }
    if (excerpts.join('\n').length >= maxChars) break
  }
  return excerpts.join('\n').slice(0, maxChars)
}
