import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { isRunState, type RunState, type RunStatus } from './harness/run-store.js'
import type { ChoxPaths } from './paths.js'
import { readSubstrateHealth, type SubstrateHealth } from './substrate/store.js'

export interface RunSummary {
  runId: string
  slug: string
  status: RunStatus
  currentHop: number
  totalHops: number | undefined
  branch: string
  updatedAt: string
}

export interface StatusReport {
  runs: RunSummary[]
  totalRuns: number
  unreadableRuns: number
  unreadablePlans: number
  worktrees: {
    total: number
    active: number
    orphaned: number
  }
  substrate: SubstrateHealth
}

const displayCap = 10
const terminalStatuses = new Set<RunStatus>(['completed', 'aborted', 'failed'])

export function isResumable(status: RunStatus): boolean {
  return status === 'running' || status === 'awaiting-gate'
}

// Status is strictly read-only: it never calls ensureChoxHome (which mkdirs),
// and every read tolerates a missing or corrupt file by counting, not throwing.
export async function collectStatus(paths: ChoxPaths): Promise<StatusReport> {
  let slugs: string[] = []
  try {
    slugs = await readdir(paths.runs)
  } catch {
    // A missing Chox home reads as an empty status.
  }
  const collected: Array<{ state: RunState, totalHops: number | undefined }> = []
  let unreadableRuns = 0
  let unreadablePlans = 0
  for (const slug of slugs) {
    let entries: string[]
    try {
      entries = await readdir(join(paths.runs, slug))
    } catch {
      unreadableRuns += 1
      continue
    }
    for (const entry of entries) {
      const dir = join(paths.runs, slug, entry)
      let state: RunState
      try {
        const value = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')) as unknown
        if (!isRunState(value)) throw new Error('invalid run-state shape')
        state = value
      } catch {
        unreadableRuns += 1
        continue
      }
      let totalHops: number | undefined
      try {
        const value = JSON.parse(await readFile(join(dir, 'plan.json'), 'utf8')) as unknown
        const hops = (value as { hops?: unknown } | null)?.hops
        if (!Array.isArray(hops)) throw new Error('invalid plan shape')
        totalHops = hops.length
      } catch {
        unreadablePlans += 1
      }
      collected.push({ state, totalHops })
    }
  }

  const activePaths = new Set(
    collected
      .filter(({ state }) => !terminalStatuses.has(state.status))
      .map(({ state }) => resolve(state.worktreePath))
  )
  let worktreeNames: string[] = []
  try {
    worktreeNames = await readdir(paths.worktrees)
  } catch {
    // No worktrees directory means nothing to count.
  }
  const active = worktreeNames
    .filter((name) => activePaths.has(resolve(paths.worktrees, name)))
    .length

  collected.sort((left, right) => right.state.updatedAt.localeCompare(left.state.updatedAt))
  return {
    runs: collected.slice(0, displayCap).map(({ state, totalHops }) => ({
      runId: state.runId,
      slug: state.slug,
      status: state.status,
      currentHop: state.currentHop,
      totalHops,
      branch: state.branch,
      updatedAt: state.updatedAt
    })),
    totalRuns: collected.length,
    unreadableRuns,
    unreadablePlans,
    worktrees: {
      total: worktreeNames.length,
      active,
      orphaned: worktreeNames.length - active
    },
    substrate: readSubstrateHealth(paths)
  }
}

export function renderStatus(report: StatusReport): string {
  const lines: string[] = []
  if (report.totalRuns === 0) {
    lines.push('No runs yet. Start one with: chox run <slug>')
  } else {
    lines.push(`Runs (showing ${report.runs.length} of ${report.totalRuns}, newest first):`)
    for (const run of report.runs) {
      const hops = run.totalHops === undefined
        ? ''
        : `  hop ${Math.min(run.currentHop + 1, run.totalHops)}/${run.totalHops}`
      lines.push(`  ${run.slug}/${run.runId}  ${run.status}${hops}  ${run.branch}  updated ${run.updatedAt}`)
      if (isResumable(run.status)) {
        lines.push(`    resume: chox run ${run.slug} --resume`)
      }
    }
  }
  if (report.unreadableRuns + report.unreadablePlans > 0) {
    lines.push(
      `Note: skipped ${report.unreadableRuns} unreadable run.json file(s) and ${report.unreadablePlans} unreadable plan.json file(s).`
    )
  }
  lines.push(
    `Worktrees: ${report.worktrees.total} total (${report.worktrees.active} from active runs, ${report.worktrees.orphaned} orphaned)`
  )
  if (!report.substrate.present) {
    lines.push('Substrate: not initialized — run chox detect to scan local sessions')
  } else if (report.substrate.problem) {
    lines.push(`Substrate: unhealthy — ${report.substrate.problem}`)
  } else if (report.substrate.stats) {
    const stats = report.substrate.stats
    const sourceIds = [...new Set([
      ...Object.keys(stats.sessionsBySource),
      ...Object.keys(stats.lastScanBySource)
    ])].sort()
    lines.push('Substrate:')
    lines.push(`  Sessions: ${sourceIds.length === 0
      ? 'none'
      : sourceIds.map((id) => `${id} ${stats.sessionsBySource[id] ?? 0}`).join(', ')}`)
    lines.push(`  Last scan: ${sourceIds.length === 0
      ? 'never'
      : sourceIds.map((id) => `${id} ${stats.lastScanBySource[id] ?? 'never'}`).join(', ')}`)
    lines.push(
      `  Relay findings: ${stats.findingsByStatus.suggested} suggested, ${stats.findingsByStatus.dismissed} dismissed, ${stats.findingsByStatus.exported} exported`
    )
    if ((report.substrate.toolInvokedSessions ?? 0) > 0) {
      lines.push(`  Tool-invoked sessions: ${report.substrate.toolInvokedSessions} (excluded from handoff detection)`)
    }
    const diagnostics = sourceIds.flatMap((id) => {
      const source = stats.diagnosticsBySource[id]
      if (!source) return []
      const unknown = Object.values(source.unknownTypes).reduce((sum, count) => sum + count, 0)
      const files = source.failedFiles.length
      if (unknown + source.nullLines + files === 0) return []
      return [`${id} ${unknown} unknown, ${source.nullLines} null, ${files} file warning${files === 1 ? '' : 's'}`]
    })
    if (diagnostics.length > 0) lines.push(`  Scan diagnostics: ${diagnostics.join('; ')}`)
  }
  return `${lines.join('\n')}\n`
}
