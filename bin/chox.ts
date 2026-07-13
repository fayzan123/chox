#!/usr/bin/env node

import { stat, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { compileRelay, renderPlan } from '../src/artifacts/relay-compiler.js'
import {
  draftRelay,
  installDraftedRelay,
  parseFinding,
  persistedDraft
} from '../src/artifacts/draft-relay.js'
import { loadRelay } from '../src/artifacts/relay-loader.js'
import { buildBundle, runDoctor } from '../src/doctor.js'
import { pickEngine, type EngineStats } from '../src/engines/engine.js'
import { ChoxError, ChoxUsageError } from '../src/errors.js'
import { createTerminalGateIO, RunInterruptedError, type GateIO } from '../src/harness/gates.js'
import { executeRun } from '../src/harness/runner.js'
import { findResumableRun } from '../src/harness/run-store.js'
import { confirmHandoffCandidates } from '../src/lenses/handoff/confirm.js'
import { scanHandoff } from '../src/lenses/handoff/scan.js'
import type { Candidate, Finding } from '../src/lenses/lens.js'
import { resolvePaths } from '../src/paths.js'
import { claudeCodeSource } from '../src/sources/claude-code.js'
import { codexSource } from '../src/sources/codex.js'
import { scanSessionSources, type SourceScanResult } from '../src/sources/source.js'
import { collectStatus, renderStatus } from '../src/status.js'
import { openSubstrate, type SubstrateStore } from '../src/substrate/store.js'

const usage = `Usage:
  chox run <slug> [--dry-run] [--resume] [--unattended]
  chox detect [--source claude-code,codex] [--lens handoff] [--json] [--since 30d]
              [--engine claude|codex] [--no-confirm]
  chox install <finding-id>
  chox install --dismiss <finding-id>
  chox doctor [--bundle]
  chox status
  chox --version | --help
`

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
      unattended: { type: 'boolean' }
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
  return {
    slug: parsed.positionals[0] as string,
    dryRun: parsed.values['dry-run'] ?? false,
    resume: parsed.values.resume ?? false,
    unattended: parsed.values.unattended ?? false
  }
}

async function runCommand(args: string[], ctx: CliContext): Promise<number> {
  const flags = parseRun(args)
  const repoRoot = await findRepoRoot(ctx.cwd)
  const paths = resolvePaths(ctx.env)
  if (!flags.dryRun && !flags.unattended && !ctx.stdinIsTTY) {
    throw new ChoxError('Attended runs require a TTY. Re-run in a terminal or pass --unattended.')
  }
  const resume = flags.resume ? await findResumableRun(flags.slug, paths) : undefined
  if (flags.resume && !resume) {
    throw new ChoxError(`No resumable run was found for ${flags.slug}.`)
  }
  const plan = resume
    ? { slug: flags.slug, hops: [] }
    : compileRelay(await loadRelay(flags.slug, { repoRoot, paths }))
  if (flags.dryRun) {
    ctx.stdout(renderPlan(plan))
    return 0
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
  return {
    sourceIds: selectedSources as Array<'claude-code' | 'codex'>,
    json: parsed.values.json ?? false,
    since: parseSince(parsed.values.since),
    engine: engine as 'claude' | 'codex' | undefined,
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

function findingLine(finding: Candidate, state: 'confirmed' | 'unconfirmed'): string {
  const evidence = finding.evidence
  return `${finding.id} [${state}] ${finding.chain.join(' → ')} — ${evidence.occurrenceCount} occurrence(s), ${evidence.sessionCount} sessions across ${evidence.repos.length} repo(s); median ${evidence.medianMinutes} minutes`
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
): Promise<{ slug: string, dir: string }> {
  const stored = store.getFinding(findingId)
  if (!stored) throw new ChoxUsageError(`Finding ${JSON.stringify(findingId)} was not found`)
  if (stored.status === 'dismissed') throw new ChoxUsageError(`Finding ${findingId} is dismissed`)
  const finding = parseFinding(stored.payload)
  const payload = stored.payload as Record<string, unknown>
  const draft = persistedDraft(payload.draftedRelay)
  const repoRoot = await tryFindRepoRoot(ctx.cwd)
  const local = repoRoot !== undefined
    && finding.evidence.repos.some((repo) => resolve(repo) === resolve(repoRoot))
  const paths = resolvePaths(ctx.env)
  const baseDir = local && repoRoot
    ? join(repoRoot, '.chox', 'relays')
    : paths.relays
  return installDraftedRelay({
    store,
    findingId,
    draft,
    baseDir,
    version: await packageVersion()
  })
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
    const scannedCandidates = await scanHandoff(store, {
      sourceIds: flags.sourceIds,
      ...(flags.since ? { since: flags.since } : {})
    })
    const candidates = scannedCandidates.filter((candidate) => (
      store.getFinding(candidate.id)?.status === 'suggested'
    ))
    const belowFloor = store.listFindings({ kind: 'handoff-candidate' })
      .filter((finding) => (
        typeof finding.payload === 'object'
        && finding.payload !== null
        && (finding.payload as { surfaced?: unknown }).surfaced === false
      )).length
    let findings: Finding[] = []
    const failures: Array<{ candidateId: string, message: string }> = []
    let engineStats: EngineStats | undefined
    let engineId: string | undefined
    let missingEngine = false
    let engineAttempted = false

    if (candidates.length > 0 && !flags.noConfirm) {
      const engine = await pickEngine(flags.engine, ctx.env)
      if (!engine) {
        missingEngine = true
      } else {
        engineId = engine.id
        engineAttempted = true
        const notice = `Confirmation engine: ${engine.id}; model: ${engine.model ?? 'CLI default'}; ceiling: 3 calls per finding.\n`
        if (flags.json) ctx.stderr(notice)
        else ctx.stdout(notice)
        const outcome = await confirmHandoffCandidates({ store, candidates, engine })
        failures.push(...outcome.failures)
        for (const finding of outcome.findings) {
          try {
            const drafted = await draftRelay(finding, engine)
            const persisted = {
              slug: drafted.slug,
              relayJson: drafted.relayJson,
              templates: drafted.templates
            }
            const enriched = { ...finding, draftedRelay: persisted }
            store.upsertFinding({
              id: finding.id,
              lens: 'handoff',
              kind: 'relay',
              createdAt: new Date().toISOString(),
              status: 'suggested',
              payload: enriched
            })
            findings.push(enriched)
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
          diagnostics: Object.fromEntries(scan.map((result) => [result.sourceId, result.diagnostics]))
        },
        engine: engineId
          ? { id: engineId, model: 'CLI default', calls: engineStats?.calls ?? 0, usage: engineStats?.usage ?? {} }
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
          ...unconfirmed.map((candidate) => ({
            id: candidate.id,
            state: 'unconfirmed',
            pattern: candidate.pattern,
            chain: candidate.chain,
            evidence: candidate.evidence
          }))
        ],
        failures
      })}\n`)
      return 0
    }

    ctx.stdout(`Scanned ${counts.total} sessions across ${Object.entries(counts.bySource).map(([id, count]) => `${id} (${count})`).join(' and ')}.\n`)
    for (const result of scan) {
      const unknown = Object.values(result.diagnostics.unknownTypes).reduce((sum, count) => sum + count, 0)
      if (unknown + result.diagnostics.nullLines + result.diagnostics.failedFiles.length > 0) {
        ctx.stdout(`  ${result.sourceId} diagnostics: ${unknown} unknown entries, ${result.diagnostics.nullLines} null lines, ${result.diagnostics.failedFiles.length} file warning(s).\n`)
      }
    }
    if (candidates.length === 0) {
      ctx.stdout(renderNoFindings(counts, belowFloor).split('\n').slice(1).join('\n'))
      return 0
    }
    if (flags.noConfirm) {
      ctx.stdout('Confirmation skipped by --no-confirm; candidates are unconfirmed and no engine was spawned.\n')
    } else if (missingEngine) {
      ctx.stdout('No analysis engine is available; candidates are unconfirmed. Install Claude Code or Codex CLI, then rerun detect, or use --no-confirm.\n')
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

    if (findings.length > 0 && ctx.stdinIsTTY) {
      const io = ctx.gateIO ?? createTerminalGateIO(ctx.env)
      for (const finding of findings) {
        const action = await io.readKey(
          `Finding ${finding.id}: [i]nstall [d]ismiss [s]kip `,
          ['i', 'd', 's']
        )
        if (action === 'i') {
          const installed = await installFinding(finding.id, store, ctx)
          ctx.stdout(`Installed relay ${installed.slug} at ${installed.dir}\n`)
        } else if (action === 'd') {
          store.updateFindingStatus(finding.id, 'dismissed')
          ctx.stdout(`Dismissed finding ${finding.id}.\n`)
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
    if (command === 'run') return await runCommand(rest, ctx)
    if (command === 'detect') return await detectCommand(rest, ctx)
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
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === resolve(invokedPath)) {
  process.exitCode = await main()
}
