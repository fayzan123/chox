import { join } from 'node:path'

import type { CompiledHop, ExecutionPlan } from '../artifacts/relay-compiler.js'
import type { Interaction } from '../artifacts/ir.js'
import type {
  RuntimeEvent,
  RuntimeProbe,
  TokenUsage
} from '../runtimes/runtime.js'
import type { FootprintChange } from './autonomy.js'
import { summarizeFootprint, type GateIO } from './gates.js'
import { readEvents } from './run-events.js'
import type { RunHandle, RunStatus } from './run-store.js'

export function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
}

export function runtimeVersion(probe: RuntimeProbe | undefined): string {
  const value = probe?.version?.trim()
  if (!value) return 'version unknown'
  return value.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] ?? value
}

function compact(value: string, max = 72): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1).trimEnd()}…`
}

function meaningfulEvent(event: RuntimeEvent): string | undefined {
  if (event.kind === 'message') return compact(event.text)
  if (event.kind === 'command') return compact(`command: ${event.command}`)
  if (event.kind === 'session') return `model ${event.model}`
  if (event.kind === 'usage') return 'token usage received'
  return undefined
}

export function createHeartbeat(opts: {
  io: GateIO
  hop: CompiledHop
  totalHops: number
  startedAt: number
}) {
  let eventCount = 0
  let lastMeaningful = 'waiting for agent output'
  const transient = opts.io.isTTY === true
  const render = () => {
    const line = `Hop ${opts.hop.index + 1}/${opts.totalHops} · ${formatDuration(Date.now() - opts.startedAt)} elapsed · ${eventCount} events · ${lastMeaningful}`
    if (opts.io.progress) opts.io.progress(line, transient)
    else opts.io.print(line)
  }
  render()
  const timer = setInterval(render, transient ? 5_000 : 30_000)
  timer.unref()
  return {
    observe(event: RuntimeEvent) {
      eventCount += 1
      lastMeaningful = meaningfulEvent(event) ?? lastMeaningful
    },
    stop() {
      clearInterval(timer)
      opts.io.clearProgress?.()
    }
  }
}

export interface HopSummary {
  durationMs: number
  interaction: Interaction
  model: string
  usage?: TokenUsage
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function tokenUsage(value: unknown): TokenUsage | undefined {
  const usage = record(value)
  if (!usage) return undefined
  const result: TokenUsage = {}
  for (const [source, target] of [
    ['inputTokens', 'inputTokens'],
    ['outputTokens', 'outputTokens'],
    ['cachedInputTokens', 'cachedInputTokens'],
    ['totalTokens', 'totalTokens']
  ] as const) {
    const count = usage[source]
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      result[target] = count
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function addUsage(left: TokenUsage | undefined, right: TokenUsage | undefined): TokenUsage | undefined {
  if (!left) return right
  if (!right) return left
  const result: TokenUsage = {}
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens'] as const) {
    const a = left[key]
    const b = right[key]
    if (a !== undefined || b !== undefined) result[key] = (a ?? 0) + (b ?? 0)
  }
  return result
}

export async function hopSummaries(eventsPath: string, plan: ExecutionPlan): Promise<HopSummary[]> {
  const summaries: HopSummary[] = plan.hops.map((hop) => ({
    durationMs: 0,
    interaction: hop.interaction,
    model: hop.model ?? 'CLI default'
  } satisfies HopSummary))
  for await (const event of readEvents(eventsPath)) {
    if (event.type !== 'hop:end' || typeof event.hop !== 'number') continue
    const summary = summaries[event.hop]
    if (!summary) continue
    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
      summary.durationMs += Math.max(0, event.durationMs)
    }
    if (event.interaction === 'interactive' || event.interaction === 'headless') {
      summary.interaction = event.interaction
    }
    if (typeof event.model === 'string' && event.model.trim() !== '') summary.model = event.model
    const combinedUsage = addUsage(summary.usage, tokenUsage(event.usage))
    if (combinedUsage) summary.usage = combinedUsage
  }
  return summaries
}

function formatUsage(summary: HopSummary): string {
  if (summary.interaction === 'interactive') return 'n/a (interactive session)'
  const usage = summary.usage
  if (!usage) return 'n/a (not reported)'
  const parts: string[] = []
  if (usage.inputTokens !== undefined) parts.push(`${usage.inputTokens.toLocaleString('en-US')} in`)
  if (usage.cachedInputTokens !== undefined) {
    parts.push(`${usage.cachedInputTokens.toLocaleString('en-US')} cached`)
  }
  if (usage.outputTokens !== undefined) parts.push(`${usage.outputTokens.toLocaleString('en-US')} out`)
  if (usage.totalTokens !== undefined) parts.push(`${usage.totalTokens.toLocaleString('en-US')} total`)
  return parts.join(', ') || 'n/a (not reported)'
}

export function renderCompletionSummary(opts: {
  handle: RunHandle
  status: RunStatus
  plan: ExecutionPlan
  summaries: HopSummary[]
  branch: string
  baseCommit: string
  overallChanges?: FootprintChange[]
  overallProblem?: string
  reason?: string
}): string {
  const elapsed = Date.now() - Date.parse(opts.handle.state.createdAt)
  const lines = [
    `Run ${opts.status} · ${formatDuration(Number.isFinite(elapsed) ? elapsed : 0)} · ${opts.plan.hops.length} hop${opts.plan.hops.length === 1 ? '' : 's'}`
  ]
  if (opts.reason) lines.push(`Reason: ${compact(opts.reason, 240)}`)
  for (const [index, hop] of opts.plan.hops.entries()) {
    const summary = opts.summaries[index] ?? {
      durationMs: 0,
      interaction: hop.interaction,
      model: hop.model ?? 'CLI default'
    }
    lines.push(
      `  Hop ${index + 1} · ${hop.role} · ${hop.runtime} · model ${summary.model} · ${summary.interaction} · ${formatDuration(summary.durationMs)} · tokens ${formatUsage(summary)}`
    )
  }
  lines.push(
    opts.overallChanges
      ? summarizeFootprint(opts.overallChanges, 'Files changed overall')
      : `Files changed overall: unavailable${opts.overallProblem ? ` (${compact(opts.overallProblem, 80)})` : ''}`,
    `Base commit: ${opts.baseCommit}`,
    `Branch: ${opts.branch}`
  )
  if (opts.status === 'completed') {
    lines.push(`Merge: git merge ${opts.branch}`)
  } else {
    lines.push(`Inspect: git show --stat ${opts.branch} (work is preserved; start a new run to retry).`)
  }
  lines.push(`Artifact snapshots: ${join(opts.handle.dir, 'artifacts')}`)
  return lines.join('\n')
}
