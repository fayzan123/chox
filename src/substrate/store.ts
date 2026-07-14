import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { ChoxError } from '../errors.js'
import type { ChoxPaths } from '../paths.js'
import type { ParsedSession, SourceDiagnostics } from '../sources/source.js'

export type FindingStatus = 'suggested' | 'dismissed' | 'exported'

export interface StoredSource {
  id: string
  kind: string
  rootPath: string
  lastScanAt?: string
  diagnostics?: SourceDiagnostics
}

export interface StoredSession {
  id: string
  sourceId: string
  ref: string
  repoRoot: string
  cwd: string
  originator?: string
  startedAt: string
  endedAt: string
  meta: Record<string, unknown>
  intentDigest: string
}

export interface StoredFinding {
  id: string
  lens: string
  kind: string
  createdAt: string
  status: FindingStatus
  payload: unknown
}

export interface StoredArtifact {
  id: string
  findingId: string
  kind: string
  slug: string
  placedPaths: string[]
  createdAt: string
}

export interface StoredWatermark {
  sourceId: string
  fileRef: string
  mtime: number
  size: number
}

export interface SubstrateStats {
  sessionsBySource: Record<string, number>
  lastScanBySource: Record<string, string | undefined>
  diagnosticsBySource: Record<string, SourceDiagnostics>
  findingsByStatus: Record<FindingStatus, number>
}

export interface SubstrateHealth {
  present: boolean
  stats?: SubstrateStats
  problem?: string
}

export interface SubstrateStore {
  upsertSource(source: StoredSource): void
  listSources(): StoredSource[]
  replaceSession(sourceId: string, ref: string, session: ParsedSession): void
  listSessions(opts?: { sourceIds?: string[], since?: string }): StoredSession[]
  getSession(id: string): StoredSession | undefined
  deleteSessionByRef(sourceId: string, ref: string): void
  getWatermark(sourceId: string, fileRef: string): StoredWatermark | undefined
  upsertWatermark(watermark: StoredWatermark): void
  upsertFinding(finding: StoredFinding): StoredFinding
  getFinding(id: string): StoredFinding | undefined
  listFindings(opts?: { lens?: string, kind?: string, status?: FindingStatus }): StoredFinding[]
  updateFindingStatus(id: string, status: FindingStatus): boolean
  insertArtifact(artifact: StoredArtifact): void
  stats(): SubstrateStats
  close(): void
}

interface SessionRow {
  id: string
  source_id: string
  ref: string
  repo_root: string
  cwd: string
  originator: string | null
  started_at: string
  ended_at: string
  meta_json: string
  intent_digest: string
}

interface FindingRow {
  id: string
  lens: string
  kind: string
  created_at: string
  status: string
  payload_json: string
}

function schemaText(): string {
  const adjacent = fileURLToPath(new URL('./schema.sql', import.meta.url))
  const sourceTree = fileURLToPath(new URL('../../../src/substrate/schema.sql', import.meta.url))
  for (const candidate of [adjacent, sourceTree]) {
    try {
      return readFileSync(candidate, 'utf8')
    } catch {
      // Try the source asset shipped with the package after the compiled path.
    }
  }
  throw new ChoxError('Chox installation is missing src/substrate/schema.sql. Reinstall Chox.')
}

function parseObject(text: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    // Fall through to the boundary error.
  }
  throw new ChoxError(`Substrate contains invalid ${label}. Delete the database to rebuild it.`)
}

function parsePayload(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ChoxError('Substrate contains an invalid finding payload. Delete the database to rebuild it.')
  }
}

function parseDiagnostics(text: string | null): SourceDiagnostics | undefined {
  if (text === null) return undefined
  const value = parseObject(text, 'source diagnostics')
  if (
    typeof value.nullLines !== 'number'
    || !Number.isInteger(value.nullLines)
    || value.nullLines < 0
    || !Array.isArray(value.failedFiles)
    || !value.failedFiles.every((item) => typeof item === 'string')
    || typeof value.unknownTypes !== 'object'
    || value.unknownTypes === null
    || Array.isArray(value.unknownTypes)
  ) throw new ChoxError('Substrate contains invalid source diagnostics. Delete the database to rebuild it.')
  const unknownTypes = value.unknownTypes as Record<string, unknown>
  if (!Object.values(unknownTypes).every((count) => (
    typeof count === 'number' && Number.isInteger(count) && count >= 0
  ))) throw new ChoxError('Substrate contains invalid source diagnostics. Delete the database to rebuild it.')
  return {
    unknownTypes: unknownTypes as Record<string, number>,
    nullLines: value.nullLines,
    failedFiles: value.failedFiles as string[]
  }
}

function hasSourceDiagnostics(db: DatabaseSync): boolean {
  return db.prepare('PRAGMA table_info(sources)').all()
    .some((row) => (row as { name?: unknown }).name === 'diagnostics_json')
}

function findingStatus(value: string): FindingStatus {
  if (value === 'suggested' || value === 'dismissed' || value === 'exported') return value
  throw new ChoxError('Substrate contains an invalid finding status. Delete the database to rebuild it.')
}

function sessionFromRow(row: SessionRow): StoredSession {
  return {
    id: row.id,
    sourceId: row.source_id,
    ref: row.ref,
    repoRoot: row.repo_root,
    cwd: row.cwd,
    ...(row.originator === null ? {} : { originator: row.originator }),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    meta: parseObject(row.meta_json, 'session metadata'),
    intentDigest: row.intent_digest
  }
}

function findingFromRow(row: FindingRow): StoredFinding {
  return {
    id: row.id,
    lens: row.lens,
    kind: row.kind,
    createdAt: row.created_at,
    status: findingStatus(row.status),
    payload: parsePayload(row.payload_json)
  }
}

class SqliteSubstrateStore implements SubstrateStore {
  readonly #db: DatabaseSync
  readonly #hasSourceDiagnostics: boolean

  constructor(db: DatabaseSync) {
    this.#db = db
    this.#hasSourceDiagnostics = hasSourceDiagnostics(db)
  }

  upsertSource(source: StoredSource): void {
    this.#db.prepare(`
      INSERT INTO sources (id, kind, root_path, last_scan_at, diagnostics_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        root_path = excluded.root_path,
        last_scan_at = COALESCE(excluded.last_scan_at, sources.last_scan_at),
        diagnostics_json = COALESCE(excluded.diagnostics_json, sources.diagnostics_json)
    `).run(
      source.id,
      source.kind,
      source.rootPath,
      source.lastScanAt ?? null,
      source.diagnostics ? JSON.stringify(source.diagnostics) : null
    )
  }

  listSources(): StoredSource[] {
    const diagnostics = this.#hasSourceDiagnostics ? 'diagnostics_json' : 'NULL AS diagnostics_json'
    const rows = this.#db.prepare(`
      SELECT id, kind, root_path, last_scan_at, ${diagnostics} FROM sources ORDER BY id
    `).all() as Array<{
      id: string
      kind: string
      root_path: string
      last_scan_at: string | null
      diagnostics_json: string | null
    }>
    return rows.map((row) => {
      const parsedDiagnostics = parseDiagnostics(row.diagnostics_json)
      return {
        id: row.id,
        kind: row.kind,
        rootPath: row.root_path,
        ...(row.last_scan_at === null ? {} : { lastScanAt: row.last_scan_at }),
        ...(parsedDiagnostics ? { diagnostics: parsedDiagnostics } : {})
      }
    })
  }

  replaceSession(sourceId: string, ref: string, session: ParsedSession): void {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      this.#db.prepare(`
        INSERT INTO sessions (
          id, source_id, ref, repo_root, cwd, originator,
          started_at, ended_at, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_id = excluded.source_id,
          ref = excluded.ref,
          repo_root = excluded.repo_root,
          cwd = excluded.cwd,
          originator = excluded.originator,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          meta_json = excluded.meta_json
      `).run(
        session.meta.id,
        sourceId,
        ref,
        session.meta.repoRoot,
        session.meta.cwd,
        session.meta.originator ?? null,
        session.meta.startedAt,
        session.meta.endedAt,
        JSON.stringify(session.meta.metadata)
      )
      this.#db.prepare('DELETE FROM units WHERE session_id = ?').run(session.meta.id)
      const insertUnit = this.#db.prepare(`
        INSERT INTO units (
          id, session_id, started_at, ended_at, intent_digest, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const unit of session.units) {
        insertUnit.run(
          unit.id,
          session.meta.id,
          unit.startedAt,
          unit.endedAt,
          unit.intentDigest,
          JSON.stringify(unit.metadata)
        )
      }
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  listSessions(opts: { sourceIds?: string[], since?: string } = {}): StoredSession[] {
    const clauses: string[] = []
    const params: string[] = []
    if (opts.sourceIds && opts.sourceIds.length > 0) {
      clauses.push(`s.source_id IN (${opts.sourceIds.map(() => '?').join(', ')})`)
      params.push(...opts.sourceIds)
    }
    if (opts.since) {
      clauses.push('s.ended_at >= ?')
      params.push(opts.since)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.#db.prepare(`
      SELECT s.id, s.source_id, s.ref, s.repo_root, s.cwd, s.originator,
             s.started_at, s.ended_at, s.meta_json,
             COALESCE(u.intent_digest, '') AS intent_digest
      FROM sessions s
      LEFT JOIN units u ON u.session_id = s.id
      ${where}
      ORDER BY s.started_at, s.id
    `).all(...params) as unknown as SessionRow[]
    return rows.map(sessionFromRow)
  }

  getSession(id: string): StoredSession | undefined {
    const row = this.#db.prepare(`
      SELECT s.id, s.source_id, s.ref, s.repo_root, s.cwd, s.originator,
             s.started_at, s.ended_at, s.meta_json,
             COALESCE(u.intent_digest, '') AS intent_digest
      FROM sessions s
      LEFT JOIN units u ON u.session_id = s.id
      WHERE s.id = ?
    `).get(id) as unknown as SessionRow | undefined
    return row ? sessionFromRow(row) : undefined
  }

  deleteSessionByRef(sourceId: string, ref: string): void {
    this.#db.prepare('DELETE FROM sessions WHERE source_id = ? AND ref = ?').run(sourceId, ref)
  }

  getWatermark(sourceId: string, fileRef: string): StoredWatermark | undefined {
    const row = this.#db.prepare(`
      SELECT source_id, file_ref, mtime, size
      FROM watermarks WHERE source_id = ? AND file_ref = ?
    `).get(sourceId, fileRef) as {
      source_id: string
      file_ref: string
      mtime: number
      size: number
    } | undefined
    return row
      ? { sourceId: row.source_id, fileRef: row.file_ref, mtime: row.mtime, size: row.size }
      : undefined
  }

  upsertWatermark(watermark: StoredWatermark): void {
    this.#db.prepare(`
      INSERT INTO watermarks (source_id, file_ref, mtime, size)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source_id, file_ref) DO UPDATE SET
        mtime = excluded.mtime,
        size = excluded.size
    `).run(watermark.sourceId, watermark.fileRef, watermark.mtime, watermark.size)
  }

  upsertFinding(finding: StoredFinding): StoredFinding {
    this.#db.prepare(`
      INSERT INTO findings (id, lens, kind, created_at, status, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        lens = excluded.lens,
        kind = excluded.kind,
        payload_json = excluded.payload_json
    `).run(
      finding.id,
      finding.lens,
      finding.kind,
      finding.createdAt,
      finding.status,
      JSON.stringify(finding.payload)
    )
    const stored = this.getFinding(finding.id)
    if (!stored) throw new ChoxError(`Could not persist finding ${finding.id}.`)
    return stored
  }

  getFinding(id: string): StoredFinding | undefined {
    const row = this.#db.prepare(`
      SELECT id, lens, kind, created_at, status, payload_json
      FROM findings WHERE id = ?
    `).get(id) as unknown as FindingRow | undefined
    return row ? findingFromRow(row) : undefined
  }

  listFindings(
    opts: { lens?: string, kind?: string, status?: FindingStatus } = {}
  ): StoredFinding[] {
    const clauses: string[] = []
    const params: string[] = []
    if (opts.lens) {
      clauses.push('lens = ?')
      params.push(opts.lens)
    }
    if (opts.kind) {
      clauses.push('kind = ?')
      params.push(opts.kind)
    }
    if (opts.status) {
      clauses.push('status = ?')
      params.push(opts.status)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.#db.prepare(`
      SELECT id, lens, kind, created_at, status, payload_json
      FROM findings ${where}
      ORDER BY created_at DESC, id
    `).all(...params) as unknown as FindingRow[]
    return rows.map(findingFromRow)
  }

  updateFindingStatus(id: string, status: FindingStatus): boolean {
    const result = this.#db.prepare('UPDATE findings SET status = ? WHERE id = ?').run(status, id)
    return result.changes > 0
  }

  insertArtifact(artifact: StoredArtifact): void {
    this.#db.prepare(`
      INSERT INTO artifacts (
        id, finding_id, kind, slug, placed_paths_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      artifact.id,
      artifact.findingId,
      artifact.kind,
      artifact.slug,
      JSON.stringify(artifact.placedPaths),
      artifact.createdAt
    )
  }

  stats(): SubstrateStats {
    const sessionRows = this.#db.prepare(`
      SELECT source_id, COUNT(*) AS count FROM sessions GROUP BY source_id
    `).all() as Array<{ source_id: string, count: number }>
    const diagnostics = this.#hasSourceDiagnostics ? 'diagnostics_json' : 'NULL AS diagnostics_json'
    const sourceRows = this.#db.prepare(`
      SELECT id, last_scan_at, ${diagnostics} FROM sources ORDER BY id
    `).all() as Array<{ id: string, last_scan_at: string | null, diagnostics_json: string | null }>
    const findingRows = this.#db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM findings WHERE kind = 'relay' GROUP BY status
    `).all() as Array<{ status: string, count: number }>
    const findingsByStatus: Record<FindingStatus, number> = {
      suggested: 0,
      dismissed: 0,
      exported: 0
    }
    for (const row of findingRows) findingsByStatus[findingStatus(row.status)] = row.count
    return {
      sessionsBySource: Object.fromEntries(sessionRows.map((row) => [row.source_id, row.count])),
      lastScanBySource: Object.fromEntries(sourceRows.map((row) => [
        row.id,
        row.last_scan_at ?? undefined
      ])),
      diagnosticsBySource: Object.fromEntries(sourceRows.flatMap((row) => {
        const parsed = parseDiagnostics(row.diagnostics_json)
        return parsed ? [[row.id, parsed]] : []
      })),
      findingsByStatus
    }
  }

  close(): void {
    this.#db.close()
  }
}

export function openSubstrate(paths: ChoxPaths): SubstrateStore {
  mkdirSync(dirname(paths.substrate), { recursive: true, mode: 0o700 })
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(paths.substrate)
    chmodSync(paths.substrate, 0o600)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(schemaText())
    if (!hasSourceDiagnostics(db)) {
      db.exec('ALTER TABLE sources ADD COLUMN diagnostics_json TEXT')
    }
    db.prepare('SELECT COUNT(*) AS count FROM sources').get()
    return new SqliteSubstrateStore(db)
  } catch (error) {
    try {
      db?.close()
    } catch {
      // Preserve the original open/schema failure.
    }
    throw new ChoxError(
      `Could not open substrate at ${resolve(paths.substrate)}. Delete ${resolve(paths.substrate)} to rebuild it (it is a cache).`,
      1,
      { cause: error }
    )
  }
}

export function readSubstrateHealth(paths: ChoxPaths): SubstrateHealth {
  if (!existsSync(paths.substrate)) return { present: false }
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(paths.substrate, { readOnly: true })
    const store = new SqliteSubstrateStore(db)
    const stats = store.stats()
    store.close()
    db = undefined
    return { present: true, stats }
  } catch {
    try {
      db?.close()
    } catch {
      // Preserve the stable health result.
    }
    return {
      present: true,
      problem: `unreadable or corrupt — delete ${resolve(paths.substrate)} to rebuild it (it is a cache)`
    }
  }
}
