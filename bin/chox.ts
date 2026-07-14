#!/usr/bin/env node

import { stat, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, TextDecoder } from 'node:util'

import {
  compileRelay,
  relayConsumesTask,
  renderPlan
} from '../src/artifacts/relay-compiler.js'
import {
  draftRelay,
  installDraftedRelay,
  parseFinding,
  persistedDraft,
  persistedDraftConsumesTask
} from '../src/artifacts/draft-relay.js'
import {
  inspectFinding,
  renderFinding
} from '../src/artifacts/finding-inspection.js'
import {
  catalogRelays,
  inspectRelay,
  renderRelayList,
  renderRelayShow
} from '../src/artifacts/relay-catalog.js'
import { loadRelay } from '../src/artifacts/relay-loader.js'
import { buildBundle, runDoctor } from '../src/doctor.js'
import { pickEngine, type EngineStats } from '../src/engines/engine.js'
import { ChoxError, ChoxUsageError } from '../src/errors.js'
import { createTerminalGateIO, RunInterruptedError, type GateIO } from '../src/harness/gates.js'
import { executeRun } from '../src/harness/runner.js'
import { findResumableRun } from '../src/harness/run-store.js'
import { confirmHandoffCandidates } from '../src/lenses/handoff/confirm.js'
import {
  findCoveringRelay,
  resolveInstalledRelayShapes
} from '../src/lenses/handoff/covered.js'
import {
  renderOccurrenceChain,
  scanHandoffReport
} from '../src/lenses/handoff/scan.js'
import type { Candidate, Finding } from '../src/lenses/lens.js'
import { resolvePaths } from '../src/paths.js'
import { claudeCodeSource } from '../src/sources/claude-code.js'
import { codexSource } from '../src/sources/codex.js'
import { scanSessionSources, type SourceScanResult } from '../src/sources/source.js'
import { collectStatus, renderStatus } from '../src/status.js'
import { openSubstrate, type SubstrateStore } from '../src/substrate/store.js'

const usage = `Usage:
  chox run <slug> [--task <text> | --task-file <path>] [--dry-run] [--resume] [--unattended]
  chox detect [--source claude-code,codex] [--lens handoff] [--json] [--since 30d]
              [--engine claude|codex] [--model <name>] [--no-confirm]
  chox relay list [--json]
  chox relay show <slug> [--prompts] [--json]
  chox finding show <finding-id> [--prompts] [--json]
  chox install <finding-id>
  chox install --dismiss <finding-id>
  chox doctor [--bundle]
  chox status
  chox --version | --help
`

const commandHelp: Record<string, string> = {
  run: `Usage: chox run <slug> [--task <text> | --task-file <path>] [--dry-run] [--resume] [--unattended]

Run a relay in an isolated Git worktree. Task flags are mutually exclusive and cannot
be used with --resume; resume always uses the persisted compiled plan. Run records in
~/.chox/runs contain compiled prompts and task text.
`,
  detect: `Usage: chox detect [--source claude-code,codex] [--lens handoff] [--json] [--since 30d]
                   [--engine claude|codex] [--model <name>] [--no-confirm]

Scan local agent histories and inspect or install evidence-backed workflow findings.
--no-confirm starts no analysis agent. JSON progress and notices use stderr.
`,
  relay: `Usage:
  chox relay list [--json]
  chox relay show <slug> [--prompts] [--json]

Discover repository, global, and read-only built-in relays. Full template text is
shown only with --prompts.
`,
  finding: `Usage: chox finding show <finding-id> [--prompts] [--json]

Inspect persisted evidence, proposed workflow details, and analysis spend. Full
prompt text is shown only with --prompts.
`,
  doctor: `Usage: chox doctor [--bundle]

Check the local environment. Diagnostic bundles contain allowlisted, redacted probe
data and never task text, compiled prompts, or commands.
`,
  status: `Usage: chox status

Show substrate, run, worktree, and resumable-gate status without changing state.
`
}

const maxTaskBytes = 1024 * 1024

export interface CliContext {
  cwd: string
  env: NodeJS.ProcessEnv
  stdinIsTTY: boolean
  stdout(text: string): void
  stderr(text: string): void
  gateIO?: GateIO
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function findRepoRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  while (true) {
    if (await pathExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) {
      throw new ChoxUsageError('chox run requires a working directory inside a Git repository')
    }
    current = parent
  }
}

async function tryFindRepoRoot(cwd: string): Promise<string | undefined> {
  try {
    return await findRepoRoot(cwd)
  } catch {
    return undefined
  }
}

async function packageVersion(): Promise<string> {
  let current = dirname(fileURLToPath(import.meta.url))
  while (true) {
    const candidate = join(current, 'package.json')
    try {
      const value = JSON.parse(await readFile(candidate, 'utf8')) as { version?: unknown }
      if (typeof value.version === 'string') return value.version
    } catch {
      // Continue towards the repository/package root.
    }
    const parent = dirname(current)
    if (parent === current) throw new Error('Could not locate package.json')
    current = parent
  }
}

function parseRun(args: string[]) {
  const parsed = parseArgs({
    args,
    options: {
      'dry-run': { type: 'boolean' },
      resume: { type: 'boolean' },
      unattended: { type: 'boolean' },
      task: { type: 'string' },
      'task-file': { type: 'string' }
    },
    allowPositionals: true,
    strict: true
  })
  if (parsed.positionals.length !== 1) {
    throw new ChoxUsageError('chox run requires exactly one relay slug')
  }
  if (parsed.values['dry-run'] && parsed.values.resume) {
    throw new ChoxUsageError('--dry-run and --resume cannot be used together')
  }
  if (parsed.values.task !== undefined && parsed.values['task-file'] !== undefined) {
    throw new ChoxUsageError('--task and --task-file are mutually exclusive')
  }
  if (parsed.values.resume && (parsed.values.task !== undefined || parsed.values['task-file'] !== undefined)) {
    throw new ChoxUsageError('--task and --task-file cannot be used with --resume; resume uses the persisted plan')
  }
  return {
    slug: parsed.positionals[0] as string,
    dryRun: parsed.values['dry-run'] ?? false,
    resume: parsed.values.resume ?? false,
    unattended: parsed.values.unattended ?? false,
    task: parsed.values.task,
    taskFile: parsed.values['task-file']
  }
}

function validateTaskText(text: string, label: string): string {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxTaskBytes) {
    throw new ChoxUsageError(`${label} exceeds the 1 MiB limit (1,048,576 bytes)`)
  }
  if (text.trim() === '') throw new ChoxUsageError(`${label} must not be empty or whitespace-only`)
  return text
}

async function resolveTaskInput(
  flags: ReturnType<typeof parseRun>,
  cwd: string
): Promise<string | undefined> {
  if (flags.task !== undefined) return validateTaskText(flags.task, '--task')
  if (flags.taskFile === undefined) return undefined
  if (flags.taskFile.trim() === '') throw new ChoxUsageError('--task-file requires a path')
  const path = resolve(cwd, flags.taskFile)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    throw new ChoxUsageError(
      `Could not read task file ${path}. Ensure it exists and is readable.`,
      { cause: error }
    )
  }
  if (bytes.byteLength > maxTaskBytes) {
    throw new ChoxUsageError(`Task file ${path} exceeds the 1 MiB limit (1,048,576 bytes)`)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new ChoxUsageError(`Task file ${path} is not valid UTF-8`, { cause: error })
  }
  return validateTaskText(text, `Task file ${path}`)
}

async function runCommand(args: string[], ctx: CliContext): Promise<number> {
  const flags = parseRun(args)
  const task = await resolveTaskInput(flags, ctx.cwd)
  const repoRoot = await findRepoRoot(ctx.cwd)
  const paths = resolvePaths(ctx.env)
  const resume = flags.resume ? await findResumableRun(flags.slug, paths) : undefined
  if (flags.resume && !resume) {
    throw new ChoxError(`No resumable run was found for ${flags.slug}.`)
  }
  const plan = resume
    ? { slug: flags.slug, hops: [] }
    : compileRelay(
        await loadRelay(flags.slug, { repoRoot, paths }),
        task === undefined ? {} : { task }
      )
  if (flags.dryRun) {
    ctx.stdout(renderPlan(plan))
    return 0
  }
  if (!flags.unattended && !ctx.stdinIsTTY) {
    throw new ChoxError('Attended runs require a TTY. Re-run in a terminal or pass --unattended.')
  }
  const io = ctx.gateIO ?? createTerminalGateIO(ctx.env)
  const result = await executeRun({
    plan,
    repoRoot,
    paths,
    io,
    unattended: flags.unattended,
    ...(resume ? { resume } : {})
  })
  return result.status === 'completed' ? 0 : 1
}

async function doctorCommand(args: string[], ctx: CliContext): Promise<number> {
  const parsed = parseArgs({
    args,
    options: { bundle: { type: 'boolean' } },
    allowPositionals: false,
    strict: true
  })
  const paths = resolvePaths(ctx.env)
  const probes = await runDoctor({ paths, env: ctx.env })
  for (const probe of probes) {
    const marker = probe.ok ? 'ok' : probe.critical ? 'FAIL' : 'warn'
    ctx.stdout(`[${marker}] ${probe.name}: ${probe.detail}\n`)
  }
  if (parsed.values.bundle) {
    const homeDir = ctx.env.HOME?.trim() || ctx.env.USERPROFILE?.trim() || homedir()
    const bundlePath = join(ctx.cwd, 'chox-doctor-bundle.json')
    await writeFile(bundlePath, buildBundle(probes, { homeDir }))
    ctx.stdout(`Diagnostic bundle written to ${bundlePath}\n`)
  }
  return probes.some((probe) => !probe.ok) ? 1 : 0
}

async function statusCommand(args: string[], ctx: CliContext): Promise<number> {
  parseArgs({ args, options: {}, allowPositionals: false, strict: true })
  ctx.stdout(renderStatus(await collectStatus(resolvePaths(ctx.env))))
  return 0
}

function nextRunCommand(slug: string, taskRequired: boolean): string {
  return `Next: chox run ${slug}${taskRequired ? ' --task-file <task.md>' : ''} --dry-run`
}

async function resolvedRelayTaskRequirement(slug: string, ctx: CliContext): Promise<boolean> {
  const repoRoot = await tryFindRepoRoot(ctx.cwd)
  try {
    const loaded = await loadRelay(slug, {
      ...(repoRoot ? { repoRoot } : {}),
      paths: resolvePaths(ctx.env)
    })
    return relayConsumesTask(loaded)
  } catch {
    return false
  }
}

async function relayCommand(args: string[], ctx: CliContext): Promise<number> {
  const [subcommand, ...rest] = args
  const repoRoot = await tryFindRepoRoot(ctx.cwd)
  const paths = resolvePaths(ctx.env)
  if (subcommand === 'list') {
    const parsed = parseArgs({
      args: rest,
      options: { json: { type: 'boolean' } },
      allowPositionals: false,
      strict: true
    })
    const catalog = await catalogRelays({
      ...(repoRoot ? { repoRoot } : {}),
      paths
    })
    for (const warning of catalog.warnings) ctx.stderr(`Warning: ${warning}\n`)
    if (parsed.values.json) {
      ctx.stdout(`${JSON.stringify({ schemaVersion: 1, ...catalog })}\n`)
    } else {
      ctx.stdout(renderRelayList(catalog))
    }
    return 0
  }
  if (subcommand === 'show') {
    const parsed = parseArgs({
      args: rest,
      options: {
        prompts: { type: 'boolean' },
        json: { type: 'boolean' }
      },
      allowPositionals: true,
      strict: true
    })
    if (parsed.positionals.length !== 1) {
      throw new ChoxUsageError('chox relay show requires exactly one relay slug')
    }
    const relay = await inspectRelay({
      slug: parsed.positionals[0] as string,
      ...(repoRoot ? { repoRoot } : {}),
      paths,
      prompts: parsed.values.prompts ?? false
    })
    if (parsed.values.json) ctx.stdout(`${JSON.stringify({ schemaVersion: 1, relay })}\n`)
    else ctx.stdout(renderRelayShow(relay))
    return 0
  }
  throw new ChoxUsageError('chox relay requires list or show <slug>')
}

async function findingCommand(args: string[], ctx: CliContext): Promise<number> {
  const [subcommand, ...rest] = args
  if (subcommand !== 'show') throw new ChoxUsageError('chox finding requires show <finding-id>')
  const parsed = parseArgs({
    args: rest,
    options: {
      prompts: { type: 'boolean' },
      json: { type: 'boolean' }
    },
    allowPositionals: true,
    strict: true
  })
  if (parsed.positionals.length !== 1) {
    throw new ChoxUsageError('chox finding show requires exactly one finding id')
  }
  const findingId = parsed.positionals[0] as string
  const paths = resolvePaths(ctx.env)
  const store = openSubstrate(paths)
  try {
    const stored = store.getFinding(findingId)
    if (!stored) throw new ChoxUsageError(`Finding ${JSON.stringify(findingId)} was not found`)
    const repoRoot = await tryFindRepoRoot(ctx.cwd)
    const inspection = await inspectFinding({
      stored,
      ...(repoRoot ? { repoRoot } : {}),
      paths,
      prompts: parsed.values.prompts ?? false
    })
    if (parsed.values.json) {
      ctx.stdout(`${JSON.stringify(inspection)}\n`)
      return 0
    }
    ctx.stdout(renderFinding(inspection))
    if (inspection.coveredBy) {
      ctx.stdout(`Inspect: chox relay show ${inspection.coveredBy}\n`)
      ctx.stdout(`${nextRunCommand(
        inspection.coveredBy,
        inspection.workflow?.taskRequired ?? false
      )}\n`)
    } else if (inspection.state === 'suggested' && inspection.workflow) {
      ctx.stdout(`Install: chox install ${inspection.id}\n`)
    } else if (inspection.state === 'installed' && inspection.workflow) {
      ctx.stdout(`${nextRunCommand(inspection.workflow.slug, inspection.workflow.taskRequired)}\n`)
    }
    return 0
  } finally {
    store.close()
  }
}

function commaValues(value: string | undefined): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? []
}

function parseSince(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const match = /^(\d+)d$/.exec(value)
  const days = match?.[1] ? Number(match[1]) : Number.NaN
  if (!Number.isInteger(days) || days <= 0) {
    throw new ChoxUsageError('--since must be a positive day duration such as 30d')
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function parseDetect(args: string[]) {
  const parsed = parseArgs({
    args,
    options: {
      source: { type: 'string' },
      lens: { type: 'string' },
      json: { type: 'boolean' },
      since: { type: 'string' },
      engine: { type: 'string' },
      model: { type: 'string' },
      'no-confirm': { type: 'boolean' }
    },
    allowPositionals: false,
    strict: true
  })
  const sourceIds = commaValues(parsed.values.source)
  const selectedSources = sourceIds.length === 0 ? ['claude-code', 'codex'] : sourceIds
  for (const source of selectedSources) {
    if (source !== 'claude-code' && source !== 'codex') {
      throw new ChoxUsageError(`Unknown source ${JSON.stringify(source)}. Available: claude-code,codex`)
    }
  }
  const lenses = commaValues(parsed.values.lens)
  for (const lens of lenses.length === 0 ? ['handoff'] : lenses) {
    if (lens === 'profile') throw new ChoxUsageError('The profile lens ships in Phase 2')
    if (lens === 'repetition') throw new ChoxUsageError('The repetition lens ships in Phase 2/4')
    if (lens !== 'handoff') throw new ChoxUsageError(`Unknown lens ${JSON.stringify(lens)}`)
  }
  const engine = parsed.values.engine
  if (engine !== undefined && engine !== 'claude' && engine !== 'codex') {
    throw new ChoxUsageError('--engine must be claude or codex')
  }
  const model = parsed.values.model
  if (model !== undefined && model.trim() === '') {
    throw new ChoxUsageError('--model requires a model name')
  }
  return {
    sourceIds: selectedSources as Array<'claude-code' | 'codex'>,
    json: parsed.values.json ?? false,
    since: parseSince(parsed.values.since),
    engine: engine as 'claude' | 'codex' | undefined,
    model: model?.trim(),
    noConfirm: parsed.values['no-confirm'] ?? false
  }
}

function usageText(stats: EngineStats): string {
  const fields = [
    stats.usage.inputTokens === undefined ? undefined : `${stats.usage.inputTokens} input`,
    stats.usage.cachedInputTokens === undefined ? undefined : `${stats.usage.cachedInputTokens} cached`,
    stats.usage.outputTokens === undefined ? undefined : `${stats.usage.outputTokens} output`,
    stats.usage.totalTokens === undefined ? undefined : `${stats.usage.totalTokens} total`
  ].filter((value): value is string => value !== undefined)
  return fields.length === 0 ? 'not reported' : fields.join(', ')
}

function findingSummary(finding: Candidate): { chain: string, evidence: string } {
  const topOccurrence = finding.occurrences[0]
  const chain = topOccurrence?.sessions?.length
    ? renderOccurrenceChain(topOccurrence)
    : finding.chain.join(' → ')
  const evidence = finding.evidence
  const interleaved = finding.occurrences.filter((occurrence) => occurrence.interleaved).length
  const interleavedText = interleaved > 0
    ? `; ${interleaved}/${finding.occurrences.length} occurrence(s) interleaved`
    : ''
  return {
    chain,
    evidence: `${evidence.occurrenceCount} occurrence(s), ${evidence.sessionCount} sessions across ${evidence.repos.length} repo(s); median ${evidence.medianMinutes} minutes${interleavedText}`
  }
}

function findingLine(finding: Candidate, state: 'confirmed' | 'unconfirmed'): string {
  const summary = findingSummary(finding)
  return `${finding.id} [${state}] ${summary.chain} — ${summary.evidence}`
}

function coveredFindingLine(finding: Candidate): string {
  const summary = findingSummary(finding)
  return `${finding.id} [covered] ${summary.chain} — this loop is already automated by \`${finding.coveredBy}\`; ${summary.evidence}`
}

function scanCounts(
  results: SourceScanResult[],
  store: SubstrateStore,
  since?: string
): {
  total: number
  bySource: Record<string, number>
} {
  const sourceIds = results.map(({ sourceId }) => sourceId)
  const bySource: Record<string, number> = Object.fromEntries(sourceIds.map((id) => [id, 0]))
  for (const session of store.listSessions({
    sourceIds,
    ...(since ? { since } : {})
  })) {
    bySource[session.sourceId] = (bySource[session.sourceId] ?? 0) + 1
  }
  return {
    total: Object.values(bySource).reduce((sum, count) => sum + count, 0),
    bySource
  }
}

function renderNoFindings(
  counts: { total: number, bySource: Record<string, number> },
  belowFloor: number
): string {
  const sources = Object.entries(counts.bySource)
    .map(([id, count]) => `${id} (${count})`)
    .join(' and ')
  return [
    `Scanned ${counts.total} sessions across ${sources || 'the selected sources'}.`,
    'No relays detected yet.',
    '',
    `Why: ${belowFloor} cross-tool pattern(s) found, but none met the confidence threshold (≥3 sessions or ≥2 repos with the same shape).`,
    '',
    'What helps: keep using your planning agent and implementing agent on the same repos — alternation on a shared repo is the strongest signal.',
    ''
  ].join('\n')
}

async function installFinding(
  findingId: string,
  store: SubstrateStore,
  ctx: CliContext
): Promise<{ slug: string, dir: string, taskRequired: boolean }> {
  const stored = store.getFinding(findingId)
  if (!stored) throw new ChoxUsageError(`Finding ${JSON.stringify(findingId)} was not found`)
  if (stored.status === 'dismissed') throw new ChoxUsageError(`Finding ${findingId} is dismissed`)
  const finding = parseFinding(stored.payload)
  const payload = stored.payload as Record<string, unknown>
  const draft = persistedDraft(payload.draftedRelay)
  const taskRequired = persistedDraftConsumesTask(draft)
  const repoRoot = await tryFindRepoRoot(ctx.cwd)
  const local = repoRoot !== undefined
    && finding.evidence.repos.some((repo) => resolve(repo) === resolve(repoRoot))
  const paths = resolvePaths(ctx.env)
  const baseDir = local && repoRoot
    ? join(repoRoot, '.chox', 'relays')
    : paths.relays
  const installed = await installDraftedRelay({
    store,
    findingId,
    draft,
    baseDir,
    version: await packageVersion()
  })
  return { ...installed, taskRequired }
}

async function detectCommand(args: string[], ctx: CliContext): Promise<number> {
  const flags = parseDetect(args)
  const paths = resolvePaths(ctx.env)
  const userHome = ctx.env.HOME?.trim() || ctx.env.USERPROFILE?.trim() || homedir()
  const sources = flags.sourceIds.map((id) => id === 'claude-code' ? claudeCodeSource : codexSource)
  const store = openSubstrate(paths)
  try {
    const scan = await scanSessionSources({
      store,
      sources,
      homeDir: userHome,
      ...(flags.since ? { since: flags.since } : {})
    })
    const counts = scanCounts(scan, store, flags.since)
    const report = await scanHandoffReport(store, {
      sourceIds: flags.sourceIds,
      ...(flags.since ? { since: flags.since } : {}),
      worktreesRoot: paths.worktrees
    })

    if (!flags.json) {
      ctx.stdout(`Scanned ${counts.total} sessions across ${Object.entries(counts.bySource).map(([id, count]) => `${id} (${count})`).join(' and ')}.\n`)
      for (const result of scan) {
        const unknown = Object.values(result.diagnostics.unknownTypes).reduce((sum, count) => sum + count, 0)
        if (unknown + result.diagnostics.nullLines + result.diagnostics.failedFiles.length > 0) {
          ctx.stdout(`  ${result.sourceId} diagnostics: ${unknown} unknown entries, ${result.diagnostics.nullLines} null lines, ${result.diagnostics.failedFiles.length} file warning(s).\n`)
        }
      }
      if (report.toolInvokedExcluded > 0) {
        ctx.stdout(`  ${report.toolInvokedExcluded} tool-invoked session(s) excluded (Chox-spawned runs).\n`)
      }
    }

    const repoRoots = [...new Set(report.surfaced.flatMap(({ evidence }) => evidence.repos))]
    const shapes = await resolveInstalledRelayShapes({ repoRoots, paths })
    const covered: Candidate[] = []
    const uncovered: Candidate[] = []
    for (const candidate of report.surfaced) {
      const slug = findCoveringRelay(candidate, shapes)
      if (slug) {
        candidate.coveredBy = slug
        store.upsertFinding({
          id: candidate.id,
          lens: 'handoff',
          kind: 'handoff-candidate',
          createdAt: new Date().toISOString(),
          status: 'suggested',
          payload: candidate
        })
        covered.push(candidate)
      } else {
        uncovered.push(candidate)
      }
    }
    const candidates = uncovered.filter((candidate) => (
      store.getFinding(candidate.id)?.status === 'suggested'
    ))
    const belowFloor = report.belowFloor
    let findings: Finding[] = []
    const failures: Array<{ candidateId: string, message: string }> = []
    let engineStats: EngineStats | undefined
    let engineId: string | undefined
    let engineModel: string | undefined
    let missingEngine = false
    let engineAttempted = false
    const progress = (line: string): void => flags.json ? ctx.stderr(line) : ctx.stdout(line)

    if (candidates.length > 0 && !flags.noConfirm) {
      const engine = await pickEngine(
        flags.engine,
        ctx.env,
        flags.model ? { model: flags.model } : {}
      )
      if (!engine) {
        missingEngine = true
      } else {
        engineId = engine.id
        engineModel = engine.model
        engineAttempted = true
        const notice = `Confirmation engine: ${engine.id}; model: ${engine.model ?? 'CLI default'}; ceiling: 3 calls per finding.\n`
        if (flags.json) ctx.stderr(notice)
        else ctx.stdout(notice)
        const outcome = await confirmHandoffCandidates({ store, candidates, engine, progress })
        failures.push(...outcome.failures)
        for (const finding of outcome.findings) {
          const callsBefore = engine.stats().calls
          progress(`drafting ${finding.id} …\n`)
          try {
            const drafted = await draftRelay(finding, engine)
            const draftCalls = engine.stats().calls - callsBefore
            const persisted = {
              slug: drafted.slug,
              relayJson: drafted.relayJson,
              templates: drafted.templates
            }
            const enriched = {
              ...finding,
              draftedRelay: persisted,
              inspection: {
                engine: engine.id,
                model: engine.model ?? 'CLI default',
                callCeiling: 3,
                calls: finding.engineCalls + draftCalls,
                usage: engine.stats().usage,
                usageScope: 'detect-run'
              }
            }
            store.upsertFinding({
              id: finding.id,
              lens: 'handoff',
              kind: 'relay',
              createdAt: new Date().toISOString(),
              status: 'suggested',
              payload: enriched
            })
            findings.push(enriched)
            progress(
              `drafted ${finding.id} (${draftCalls} additional call(s))\n`
            )
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            failures.push({
              candidateId: finding.id,
              message
            })
            const candidate = candidates.find(({ id }) => id === finding.id)
            if (candidate) {
              store.upsertFinding({
                id: candidate.id,
                lens: 'handoff',
                kind: 'handoff-candidate',
                createdAt: new Date().toISOString(),
                status: 'suggested',
                payload: { ...candidate, draftError: message }
              })
            }
          }
        }
        engineStats = engine.stats()
      }
    }

    const confirmedIds = new Set(findings.map(({ id }) => id))
    const failureIds = new Set(failures.map(({ candidateId }) => candidateId))
    const unconfirmed = engineAttempted
      ? []
      : candidates.filter(({ id }) => !confirmedIds.has(id))
    const rejectedCount = engineAttempted
      ? candidates.filter(({ id }) => !confirmedIds.has(id) && !failureIds.has(id)).length
      : 0
    if (flags.json) {
      ctx.stdout(`${JSON.stringify({
        schemaVersion: 1,
        scan: {
          totalSessions: counts.total,
          sessionsBySource: counts.bySource,
          toolInvokedSessions: report.toolInvokedExcluded,
          diagnostics: Object.fromEntries(scan.map((result) => [result.sourceId, result.diagnostics]))
        },
        engine: engineId
          ? {
              id: engineId,
              model: engineModel ?? 'CLI default',
              calls: engineStats?.calls ?? 0,
              usage: engineStats?.usage ?? {}
            }
          : null,
        findings: [
          ...findings.map((finding) => ({
            id: finding.id,
            state: 'confirmed',
            pattern: finding.pattern,
            chain: finding.chain,
            evidence: finding.evidence,
            confirmation: finding.confirmation
          })),
          ...covered.map((candidate) => ({
            id: candidate.id,
            state: 'covered',
            coveredBy: candidate.coveredBy,
            pattern: candidate.pattern,
            chain: candidate.chain,
            evidence: candidate.evidence
          })),
          ...unconfirmed.map((candidate) => ({
            id: candidate.id,
            state: 'unconfirmed',
            pattern: candidate.pattern,
            chain: candidate.chain,
            evidence: candidate.evidence
          })),
          ...report.subsumed.map((candidate) => ({
            id: candidate.id,
            state: 'subsumed',
            subsumedBy: candidate.subsumedBy,
            pattern: candidate.pattern,
            chain: candidate.chain,
            evidence: candidate.evidence
          }))
        ],
        failures
      })}\n`)
      return 0
    }

    if (covered.length + candidates.length === 0) {
      ctx.stdout(renderNoFindings(counts, belowFloor).split('\n').slice(1).join('\n'))
      return 0
    }
    if (candidates.length > 0 && flags.noConfirm) {
      ctx.stdout('Confirmation skipped by --no-confirm; candidates are unconfirmed and no engine was spawned.\n')
    } else if (candidates.length > 0 && missingEngine) {
      ctx.stdout('No analysis engine is available; candidates are unconfirmed. Install Claude Code or Codex CLI, then rerun detect, or use --no-confirm.\n')
    }
    for (const candidate of covered) {
      ctx.stdout(`${coveredFindingLine(candidate)}\n`)
      if (candidate.coveredBy) {
        const taskRequired = await resolvedRelayTaskRequirement(candidate.coveredBy, ctx)
        ctx.stdout(`Inspect: chox relay show ${candidate.coveredBy}\n`)
        ctx.stdout(`${nextRunCommand(candidate.coveredBy, taskRequired)}\n`)
      }
    }
    for (const finding of findings) ctx.stdout(`${findingLine(finding, 'confirmed')}\n`)
    for (const candidate of unconfirmed) ctx.stdout(`${findingLine(candidate, 'unconfirmed')}\n`)
    if (rejectedCount > 0) {
      const prefix = findings.length === 0 && failures.length === 0
        ? 'No relay findings were confirmed; the engine rejected'
        : 'The engine rejected'
      ctx.stdout(`${prefix} ${rejectedCount} candidate${rejectedCount === 1 ? '' : 's'}.\n`)
    }
    for (const failure of failures) ctx.stdout(`  ${failure.candidateId}: confirmation/drafting failed — ${failure.message}\n`)
    if (engineStats) {
      ctx.stdout(`Engine spend: ${engineStats.calls} call(s); tokens: ${usageText(engineStats)}.\n`)
    }

    if (findings.length > 0 && !flags.json && ctx.stdinIsTTY) {
      const io = ctx.gateIO ?? createTerminalGateIO(ctx.env)
      for (const finding of findings) {
        while (true) {
          const action = await io.readKey(
            `Finding ${finding.id}: [v]iew [i]nstall [d]ismiss [s]kip `,
            ['v', 'i', 'd', 's']
          )
          if (action === 'v') {
            const stored = store.getFinding(finding.id)
            if (!stored) throw new ChoxError(`Finding ${finding.id} disappeared during inspection`)
            const repoRoot = await tryFindRepoRoot(ctx.cwd)
            ctx.stdout(renderFinding(await inspectFinding({
              stored,
              ...(repoRoot ? { repoRoot } : {}),
              paths,
              prompts: false
            })))
            continue
          }
          if (action === 'i') {
            const installed = await installFinding(finding.id, store, ctx)
            ctx.stdout(`Installed relay ${installed.slug} at ${installed.dir}\n`)
            ctx.stdout(`${nextRunCommand(installed.slug, installed.taskRequired)}\n`)
          } else if (action === 'd') {
            store.updateFindingStatus(finding.id, 'dismissed')
            ctx.stdout(`Dismissed finding ${finding.id}.\n`)
          }
          break
        }
      }
    } else {
      for (const finding of findings) {
        ctx.stdout(`Install with: chox install ${finding.id}\n`)
      }
    }
    return 0
  } finally {
    store.close()
  }
}

async function installCommand(args: string[], ctx: CliContext): Promise<number> {
  const parsed = parseArgs({
    args,
    options: { dismiss: { type: 'boolean' } },
    allowPositionals: true,
    strict: true
  })
  if (parsed.positionals.length !== 1) {
    throw new ChoxUsageError('chox install requires exactly one finding id')
  }
  const findingId = parsed.positionals[0] as string
  const store = openSubstrate(resolvePaths(ctx.env))
  try {
    if (parsed.values.dismiss) {
      if (!store.updateFindingStatus(findingId, 'dismissed')) {
        throw new ChoxUsageError(`Finding ${JSON.stringify(findingId)} was not found`)
      }
      ctx.stdout(`Dismissed finding ${findingId}.\n`)
      return 0
    }
    const installed = await installFinding(findingId, store, ctx)
    ctx.stdout(`Installed relay ${installed.slug} at ${installed.dir}\n`)
    ctx.stdout(`${nextRunCommand(installed.slug, installed.taskRequired)}\n`)
    return 0
  } finally {
    store.close()
  }
}

export async function runCli(args: string[], ctx: CliContext): Promise<number> {
  try {
    if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === 'help'))) {
      ctx.stdout(usage)
      return 0
    }
    if (args.length === 1 && args[0] === '--version') {
      ctx.stdout(`${await packageVersion()}\n`)
      return 0
    }
    const [command, ...rest] = args
    if (command && rest.length === 1 && rest[0] === '--help' && commandHelp[command]) {
      ctx.stdout(commandHelp[command])
      return 0
    }
    if (command === 'run') return await runCommand(rest, ctx)
    if (command === 'detect') return await detectCommand(rest, ctx)
    if (command === 'relay') return await relayCommand(rest, ctx)
    if (command === 'finding') return await findingCommand(rest, ctx)
    if (command === 'install') return await installCommand(rest, ctx)
    if (command === 'doctor') return await doctorCommand(rest, ctx)
    if (command === 'status') return await statusCommand(rest, ctx)
    throw new ChoxUsageError(`Unknown command or flag: ${String(command)}`)
  } catch (error) {
    if (error instanceof RunInterruptedError) {
      ctx.stderr('Run interrupted. Resume with chox run <slug> --resume.\n')
      return 130
    }
    const exitCode = error instanceof ChoxError ? error.exitCode : error instanceof TypeError ? 2 : 1
    const message = error instanceof Error ? error.message : String(error)
    ctx.stderr(`chox: ${message}\n`)
    if (exitCode === 2) ctx.stderr(usage)
    return exitCode
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  return runCli(args, {
    cwd: process.cwd(),
    env: process.env,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text)
  })
}

const invokedPath = process.argv[1]
const invokedRealPath = invokedPath
  ? await realpath(invokedPath).catch(() => resolve(invokedPath))
  : undefined
const moduleRealPath = await realpath(fileURLToPath(import.meta.url))
  .catch(() => resolve(fileURLToPath(import.meta.url)))
if (invokedRealPath && resolve(moduleRealPath) === resolve(invokedRealPath)) {
  process.exitCode = await main()
}
