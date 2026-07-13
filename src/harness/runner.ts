import { randomBytes } from 'node:crypto'
import { access, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type { ChildProcess } from 'node:child_process'

import type { CompiledHop, ExecutionPlan } from '../artifacts/relay-compiler.js'
import type { Interaction } from '../artifacts/ir.js'
import { ChoxError } from '../errors.js'
import type { ChoxPaths } from '../paths.js'
import { slugify } from '../slugify.js'
import {
  getRuntime,
  type RuntimeEvent,
  type RuntimeProbe,
  type TokenUsage
} from '../runtimes/runtime.js'
import {
  checkAutonomy,
  diffFootprints,
  diffFromBase,
  snapshotFootprint,
  type Deviation,
  type FootprintChange,
  type FootprintSnapshot,
  type StrictManifest
} from './autonomy.js'
import {
  presentGate,
  RunInterruptedError,
  summarizeArtifact,
  type GateIO
} from './gates.js'
import { createWorktree, sweepOrphans, teardownWorktree, type Worktree } from './isolation.js'
import { runGit } from '../system/command.js'
import {
  createHeartbeat,
  formatDuration,
  hopSummaries,
  renderCompletionSummary,
  runtimeVersion
} from './run-visibility.js'
import {
  createRun,
  saveState,
  snapshotArtifacts,
  type RunHandle,
  type RunStatus
} from './run-store.js'

export interface RunResult {
  status: 'completed' | 'aborted' | 'failed'
  runId: string
  branch?: string
}

interface HopResult {
  exitCode: number
  deviations: Deviation[]
  blocking: boolean
  degradedToChallenge: boolean
  durationMs: number
  footprint: FootprintChange[]
  interaction: Interaction
  written: string[]
  model: string
  usage?: TokenUsage
}

function generateRunId(): string {
  return `${slugify(new Date().toISOString())}-${randomBytes(2).toString('hex')}`
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function preflight(plan: ExecutionPlan): Promise<Map<string, RuntimeProbe>> {
  const ids = [...new Set(plan.hops.map((hop) => hop.runtime))]
  const results = await Promise.all(ids.map(async (id) => ({ id, probe: await getRuntime(id).preflight() })))
  const problems = results.filter(({ probe }) => !probe.present || probe.problem)
  if (problems.length > 0) {
    throw new ChoxError(
      `Agent runtime preflight failed:\n${problems.map(({ id, probe }) => `- ${id}: ${probe.problem ?? 'not present'}`).join('\n')}`
    )
  }
  return new Map(results.map(({ id, probe }) => [id, probe]))
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parsePersistedPlan(value: unknown): ExecutionPlan {
  const plan = record(value)
  if (!plan || typeof plan.slug !== 'string' || !Array.isArray(plan.hops)) {
    throw new Error('invalid plan shape')
  }
  const hops: CompiledHop[] = plan.hops.map((rawHop, position) => {
    const hop = record(rawHop)
    if (
      !hop
      || typeof hop.index !== 'number'
      || typeof hop.runtime !== 'string'
      || typeof hop.role !== 'string'
      || (hop.autonomy !== 'strict' && hop.autonomy !== 'challenge' && hop.autonomy !== 'autonomous')
      || typeof hop.prompt !== 'string'
      || !Array.isArray(hop.produces)
      || !hop.produces.every((item) => typeof item === 'string')
      || typeof hop.gated !== 'boolean'
      || (hop.model !== undefined && (typeof hop.model !== 'string' || hop.model.trim() === ''))
      || (
        hop.interaction !== undefined
        && hop.interaction !== 'interactive'
        && hop.interaction !== 'headless'
      )
    ) {
      throw new Error(`invalid persisted hop at position ${position}`)
    }
    return {
      index: hop.index,
      runtime: hop.runtime,
      role: hop.role,
      autonomy: hop.autonomy,
      prompt: hop.prompt,
      produces: hop.produces as string[],
      gated: hop.gated,
      // Plans persisted by Phase 1a predate this field and were always headless.
      interaction: hop.interaction ?? 'headless',
      ...(typeof hop.model === 'string' ? { model: hop.model } : {})
    }
  })
  return { slug: plan.slug, hops }
}

async function persistedPlan(handle: RunHandle): Promise<ExecutionPlan> {
  const path = join(handle.dir, 'plan.json')
  let plan: ExecutionPlan
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    plan = parsePersistedPlan(value)
  } catch (error) {
    throw new ChoxError(`The persisted execution plan is unreadable at ${path}: ${String(error)}`)
  }
  if (plan.hops.length === 0) {
    throw new ChoxError(`The persisted execution plan at ${path} has zero hops; refusing to resume or complete this run.`)
  }
  return plan
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

async function loadManifest(worktree: string): Promise<{
  manifest?: StrictManifest
  warning?: string
}> {
  const path = join(worktree, '.chox-run', 'manifest.json')
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const files = value.files as Record<string, unknown> | undefined
    if (
      !files
      || !stringArray(files.create)
      || !stringArray(files.modify)
      || !stringArray(files.delete)
      || !stringArray(value.commands)
    ) {
      return { warning: `Strict manifest is invalid at ${path}; degrading to challenge mode.` }
    }
    return {
      manifest: {
        files: { create: files.create, modify: files.modify, delete: files.delete },
        commands: value.commands
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return {
      warning: code === 'ENOENT'
        ? 'No earlier manifest.json is available; strict autonomy is degrading to challenge mode.'
        : `Strict manifest could not be read at ${path}; degrading to challenge mode.`
    }
  }
}

function withChallengeNotes(hop: CompiledHop): CompiledHop {
  return hop.produces.includes('.chox-run/challenge-notes.md')
    ? hop
    : { ...hop, produces: [...hop.produces, '.chox-run/challenge-notes.md'] }
}

async function waitForSpawn(child: ChildProcess): Promise<{ spawned: boolean, problem?: string }> {
  return new Promise((resolve) => {
    child.once('spawn', () => resolve({ spawned: true }))
    child.once('error', (error) => resolve({ spawned: false, problem: error.message }))
  })
}

async function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.once('close', (code) => resolve(code ?? 1))
    child.once('error', () => resolve(127))
  })
}

async function collectStderr(child: ChildProcess): Promise<string> {
  let stderr = ''
  if (!child.stderr) return stderr
  for await (const chunk of child.stderr) stderr += String(chunk)
  return stderr.trim()
}

async function runAgentAttempt(opts: {
  handle: RunHandle
  hop: CompiledHop
  worktree: string
  before: FootprintSnapshot
  manifest?: StrictManifest
  prompt: string
  interaction: Interaction
  runtimeVersion: string
  totalHops: number
  io: GateIO
}): Promise<HopResult> {
  const runtime = getRuntime(opts.hop.runtime)
  const startedAt = Date.now()
  opts.io.print(
    `Hop ${opts.hop.index + 1}/${opts.totalHops} · ${opts.hop.role} · ${opts.hop.runtime} ${opts.runtimeVersion} · model ${opts.hop.model ?? 'CLI default'} · autonomy ${opts.hop.autonomy} · ${opts.interaction}`
  )
  if (opts.interaction === 'interactive') {
    opts.io.print(
      `Opening your ${opts.hop.runtime} session in the isolated worktree — exit the session when the hop's outputs are written.`
    )
  }
  opts.io.release?.()
  const runOpts = {
    cwd: opts.worktree,
    env: process.env,
    ...(opts.hop.model !== undefined ? { model: opts.hop.model } : {})
  }
  const child = opts.interaction === 'interactive'
    ? runtime.spawnInteractive(opts.prompt, runOpts)
    : runtime.spawnHeadless(opts.prompt, runOpts)
  const exitPromise = waitForExit(child)
  const stderrPromise = collectStderr(child)
  const spawn = await waitForSpawn(child)
  let heartbeat: ReturnType<typeof createHeartbeat> | undefined
  if (spawn.spawned) {
    opts.handle.events.append('hop:start', {
      hop: opts.hop.index,
      runtime: opts.hop.runtime,
      role: opts.hop.role,
      autonomy: opts.hop.autonomy,
      interaction: opts.interaction,
      model: opts.hop.model ?? 'CLI default'
    })
    if (opts.interaction === 'headless') {
      heartbeat = createHeartbeat({
        io: opts.io,
        hop: opts.hop,
        totalHops: opts.totalHops,
        startedAt
      })
    }
  } else {
    opts.handle.events.append('agent:event', {
      hop: opts.hop.index,
      event: { kind: 'raw', line: `Runtime failed to start: ${spawn.problem ?? 'unknown error'}` }
    })
  }

  let actualModel: string | undefined
  let usage: TokenUsage | undefined
  const normalize = (async () => {
    if (!spawn.spawned || opts.interaction !== 'headless' || !child.stdout) return
    for await (const event of runtime.normalizeEvents(child.stdout)) {
      opts.handle.events.append('agent:event', { hop: opts.hop.index, event })
      heartbeat?.observe(event)
      if (event.kind === 'session') {
        actualModel = event.model
        opts.io.print(`Hop ${opts.hop.index + 1} model resolved · ${event.model}`)
      } else if (event.kind === 'usage') {
        const { kind: _kind, ...counts } = event
        usage = counts
      }
    }
  })()
  const [exitCode, stderr] = await Promise.all([exitPromise, stderrPromise])
  try {
    await normalize
  } finally {
    heartbeat?.stop()
  }
  if (stderr && exitCode !== 0) {
    const event: RuntimeEvent = { kind: 'raw', line: stderr }
    opts.handle.events.append('agent:event', { hop: opts.hop.index, event })
  }
  const written: string[] = []
  for (const artifact of opts.hop.produces) {
    if (await exists(join(opts.worktree, artifact))) {
      written.push(basename(artifact))
      opts.handle.events.append('artifact:written', {
        hop: opts.hop.index,
        name: basename(artifact),
        path: artifact
      })
    }
  }
  const autonomy = await checkAutonomy({
    hop: opts.hop,
    worktree: opts.worktree,
    before: opts.before,
    ...(opts.manifest ? { manifest: opts.manifest } : {}),
    events: opts.handle.events
  })
  const durationMs = Date.now() - startedAt
  const model = actualModel ?? opts.hop.model ?? 'CLI default'
  opts.handle.events.append('hop:end', {
    hop: opts.hop.index,
    exitCode,
    durationMs,
    interaction: opts.interaction,
    model,
    ...(usage ? { usage } : {}),
    footprint: autonomy.footprint,
    written
  })
  opts.io.print(
    `Hop ${opts.hop.index + 1} done · ${formatDuration(durationMs)} · exit ${exitCode} · wrote ${written.length > 0 ? written.join(', ') : '(none)'}`
  )
  return {
    exitCode,
    ...autonomy,
    durationMs,
    interaction: opts.interaction,
    written,
    model,
    ...(usage ? { usage } : {})
  }
}

async function runHop(opts: {
  handle: RunHandle
  hop: CompiledHop
  worktree: string
  before: FootprintSnapshot
  manifest?: StrictManifest
  prompt: string
  io: GateIO
  interaction: Interaction
  runtimeVersion: string
  totalHops: number
}): Promise<HopResult> {
  let result = await runAgentAttempt(opts)
  if (result.deviations.some((deviation) => deviation.kind === 'missing-challenge-notes')) {
    opts.io.print(`Hop ${opts.hop.index + 1} omitted challenge notes; automatically re-prompting once.`)
    await rm(join(opts.worktree, '.chox-run', 'challenge-notes.md'), { force: true })
    result = await runAgentAttempt({
      ...opts,
      prompt: `${opts.prompt}\n\n## Required challenge notes\nWrite a non-empty .chox-run/challenge-notes.md describing every intentional deviation, or explicitly state that there were none.`
    })
  }
  return result
}

async function artifactPresentation(worktree: string, hop: CompiledHop) {
  return Promise.all(hop.produces.map(async (relativePath) => {
    const path = join(worktree, relativePath)
    return {
      name: basename(relativePath),
      path,
      relativePath: relative(worktree, path).replaceAll('\\', '/'),
      summary: await summarizeArtifact(path)
    }
  }))
}

async function snapshotExisting(handle: RunHandle, hop: CompiledHop): Promise<void> {
  const existing: string[] = []
  for (const artifact of hop.produces) {
    if (await exists(join(handle.state.worktreePath, artifact))) existing.push(artifact)
  }
  await snapshotArtifacts(handle, hop.index, handle.state.worktreePath, existing)
}

async function finishRun(
  handle: RunHandle,
  wt: Worktree,
  status: RunStatus,
  io: GateIO,
  plan: ExecutionPlan,
  reason?: string
): Promise<RunResult> {
  io.release?.()
  let finalStatus: RunStatus = status
  let overallChanges: FootprintChange[] | undefined
  let overallProblem: string | undefined
  try {
    overallChanges = await diffFromBase(wt.path, wt.baseCommit)
  } catch (error) {
    overallProblem = String(error)
  }
  await saveState(handle, { status, gate: undefined })
  try {
    await teardownWorktree(wt, { commitMessage: `chox: preserve ${handle.state.slug} run ${handle.state.runId}` })
  } catch (error) {
    finalStatus = 'failed'
    await saveState(handle, { status: 'failed' })
    io.print(`Worktree cleanup failed; your work remains at ${wt.path}: ${String(error)}`)
  }
  handle.events.append('run:end', { status: finalStatus })
  await handle.events.close()
  const summaries = await hopSummaries(join(handle.dir, 'events.jsonl'), plan)
  io.print(renderCompletionSummary({
    handle,
    status: finalStatus,
    plan,
    summaries,
    branch: wt.branch,
    baseCommit: wt.baseCommit,
    ...(overallChanges ? { overallChanges } : {}),
    ...(overallProblem ? { overallProblem } : {}),
    ...(reason ? { reason } : {})
  }))
  return {
    status: finalStatus as RunResult['status'],
    runId: handle.state.runId,
    branch: wt.branch
  }
}

async function loadFootprint(handle: RunHandle, io: GateIO): Promise<FootprintSnapshot> {
  const path = join(handle.dir, 'footprint.json')
  try {
    const value = record(JSON.parse(await readFile(path, 'utf8')) as unknown)
    const entries = record(value?.entries)
    if (!value || typeof value.head !== 'string' || !entries) throw new Error('invalid footprint shape')
    for (const entry of Object.values(entries)) {
      const item = record(entry)
      if (!item || typeof item.status !== 'string' || typeof item.hash !== 'string') {
        throw new Error('invalid footprint entry')
      }
    }
    return { head: value.head, entries: entries as FootprintSnapshot['entries'] }
  } catch {
    io.print('The persisted pre-hop footprint is missing or legacy; using the current worktree as the retry baseline.')
    const snapshot = await snapshotFootprint(handle.state.worktreePath)
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`)
    return snapshot
  }
}

export async function executeRun(opts: {
  plan: ExecutionPlan
  repoRoot: string
  paths: ChoxPaths
  io: GateIO
  unattended: boolean
  resume?: RunHandle
}): Promise<RunResult> {
  let handle = opts.resume
  let wt: Worktree | undefined
  let eventsClosed = false
  let activePlan = opts.plan
  try {
    const sweep = await sweepOrphans(opts.plan.slug, opts.paths)
    for (const warning of sweep.warnings) opts.io.print(`Warning: ${warning}`)

    let plan = opts.plan
    if (handle) {
      if (!await exists(handle.state.worktreePath)) {
        throw new ChoxError(
          `The run's worktree is gone. Branch ${handle.state.branch} may still hold work; inspect it before starting a new run.`
        )
      }
      let baseCommit = handle.state.baseCommit
      if (!baseCommit) {
        const mergeBase = await runGit(handle.state.repoRoot, [
          'merge-base',
          handle.state.branch,
          'HEAD'
        ], { allowFailure: true })
        baseCommit = mergeBase.code === 0 && mergeBase.stdout.trim() !== ''
          ? mergeBase.stdout.trim()
          : handle.state.branch
      }
      wt = {
        path: handle.state.worktreePath,
        branch: handle.state.branch,
        repoRoot: handle.state.repoRoot,
        baseCommit
      }
      plan = await persistedPlan(handle)
    }
    activePlan = plan
    const probes = await preflight(plan)

    if (!handle) {
      const runId = generateRunId()
      wt = await createWorktree({ repoRoot: opts.repoRoot, slug: plan.slug, runId, paths: opts.paths })
      try {
        handle = await createRun(plan.slug, {
          runId,
          repoRoot: wt.repoRoot,
          worktreePath: wt.path,
          branch: wt.branch,
          baseCommit: wt.baseCommit
        }, plan, opts.paths)
      } catch (error) {
        await teardownWorktree(wt, { commitMessage: `chox: preserve failed run ${runId}` })
        throw error
      }
      handle.events.append('run:start', {
        slug: plan.slug,
        runId,
        worktreePath: wt.path,
        branch: wt.branch,
        dryRun: false
      })
    } else {
      handle.events.append('run:resume', {
        slug: plan.slug,
        runId: handle.state.runId,
        currentHop: handle.state.currentHop
      })
    }
    if (!wt) throw new Error('worktree was not initialized')
    opts.io.print([
      `${opts.resume ? 'Resuming' : 'Starting'} Chox run ${plan.slug}`,
      `Worktree: ${wt.path}`,
      `Branch: ${wt.branch}`,
      'Your repo is untouched; agents work in the isolated worktree.',
      `Events: ${join(handle.dir, 'events.jsonl')}`
    ].join('\n'))

    let pendingGate = handle.state.status === 'awaiting-gate'
    let resumeRunning = Boolean(opts.resume && handle.state.status === 'running')
    while (handle.state.currentHop < plan.hops.length) {
      const sourceHop = plan.hops[handle.state.currentHop]
      if (!sourceHop) throw new ChoxError(`Persisted hop index ${handle.state.currentHop} is outside the plan`)
      const manifestResult = sourceHop.autonomy === 'strict' || sourceHop.autonomy === 'autonomous'
        ? await loadManifest(wt.path)
        : {}
      if (manifestResult.warning && sourceHop.autonomy === 'strict') {
        opts.io.print(`Warning: ${manifestResult.warning}`)
      }
      const hop = sourceHop.autonomy === 'strict' && !manifestResult.manifest
        ? withChallengeNotes(sourceHop)
        : sourceHop
      const interaction: Interaction = opts.unattended ? 'headless' : hop.interaction
      const version = runtimeVersion(probes.get(hop.runtime))

      let before: FootprintSnapshot
      if (pendingGate || resumeRunning) {
        before = await loadFootprint(handle, opts.io)
      } else {
        if (hop.autonomy === 'challenge' || (sourceHop.autonomy === 'strict' && !manifestResult.manifest)) {
          await rm(join(wt.path, '.chox-run', 'challenge-notes.md'), { force: true })
        }
        before = await snapshotFootprint(wt.path)
        await writeFile(join(handle.dir, 'footprint.json'), `${JSON.stringify(before, null, 2)}\n`)
      }

      let result: HopResult
      if (pendingGate) {
        const gate = handle.state.gate
        if (!gate || gate.hop !== hop.index) {
          throw new ChoxError('The persisted awaiting-gate state is incomplete and cannot be resumed safely.')
        }
        result = {
          exitCode: gate.exitCode,
          deviations: gate.deviations,
          blocking: gate.blocking,
          degradedToChallenge: sourceHop.autonomy === 'strict' && !manifestResult.manifest,
          durationMs: 0,
          footprint: await diffFootprints(wt.path, before, await snapshotFootprint(wt.path)),
          interaction,
          written: [],
          model: hop.model ?? 'CLI default'
        }
      } else {
        if (hop.autonomy === 'challenge' || (sourceHop.autonomy === 'strict' && !manifestResult.manifest)) {
          await rm(join(wt.path, '.chox-run', 'challenge-notes.md'), { force: true })
        }
        await saveState(handle, { status: 'running', currentHop: hop.index, gate: undefined })
        result = await runHop({
          handle,
          hop,
          worktree: wt.path,
          before,
          ...(manifestResult.manifest ? { manifest: manifestResult.manifest } : {}),
          prompt: hop.prompt,
          io: opts.io,
          interaction,
          runtimeVersion: version,
          totalHops: plan.hops.length
        })
      }
      pendingGate = false
      resumeRunning = false

      while (true) {
        const blocking = result.blocking || result.exitCode !== 0
        await saveState(handle, {
          status: 'awaiting-gate',
          gate: {
            hop: hop.index,
            deviations: result.deviations,
            blocking,
            exitCode: result.exitCode
          }
        })

        if (opts.unattended || !hop.gated) {
          if (blocking) {
            return await finishRun(
              handle,
              wt,
              'failed',
              opts.io,
              plan,
              `Hop ${hop.index + 1} ended with a blocking failure.`
            )
          }
          handle.events.append('gate:action', { hop: hop.index, action: 'approve' })
          await snapshotExisting(handle, hop)
          await saveState(handle, {
            status: 'running',
            currentHop: hop.index + 1,
            gate: undefined
          })
          break
        }

        const artifacts = await artifactPresentation(wt.path, hop)
        handle.events.append('gate:presented', {
          hop: hop.index,
          artifacts: artifacts.map(({ name, path }) => ({ name, path })),
          deviationCount: result.deviations.length
        })
        if (result.exitCode !== 0) {
          opts.io.print(`Hop ${hop.index + 1} exited with code ${result.exitCode}; approval is blocked.`)
        }
        const outcome = await presentGate({
          hop,
          artifactPaths: artifacts,
          deviations: result.deviations,
          blocking,
          footprint: result.footprint,
          worktree: wt.path,
          io: opts.io
        })
        handle.events.append('gate:action', { hop: hop.index, action: outcome.action })
        if (outcome.action === 'abort') {
          opts.io.print(`Aborting; work preserved on branch ${wt.branch}…`)
          return await finishRun(handle, wt, 'aborted', opts.io, plan)
        }
        if (outcome.action === 'approve') {
          await snapshotExisting(handle, hop)
          await saveState(handle, {
            status: 'running',
            currentHop: hop.index + 1,
            gate: undefined
          })
          const nextHop = plan.hops[hop.index + 1]
          opts.io.print(
            nextHop
              ? `Approved. Continuing to hop ${nextHop.index + 1}/${plan.hops.length} (${nextHop.role})…`
              : 'Approved. Completing the run…'
          )
          break
        }

        await saveState(handle, { status: 'running', gate: undefined })
        opts.io.print(`Re-running hop ${hop.index + 1} with your note…`)
        if (hop.autonomy === 'challenge' || (sourceHop.autonomy === 'strict' && !manifestResult.manifest)) {
          await rm(join(wt.path, '.chox-run', 'challenge-notes.md'), { force: true })
        }
        result = await runHop({
          handle,
          hop,
          worktree: wt.path,
          before,
          ...(manifestResult.manifest ? { manifest: manifestResult.manifest } : {}),
          prompt: `${hop.prompt}\n\n## User redirect note\n${outcome.note}`,
          io: opts.io,
          interaction,
          runtimeVersion: version,
          totalHops: plan.hops.length
        })
      }
    }
    const final = await finishRun(handle, wt, 'completed', opts.io, plan)
    eventsClosed = true
    return final
  } catch (error) {
    if (error instanceof RunInterruptedError) {
      opts.io.release?.()
      if (handle) {
        await handle.events.close()
        eventsClosed = true
      }
      throw error
    }
    if (handle && wt) {
      try {
        const result = await finishRun(
          handle,
          wt,
          'failed',
          opts.io,
          activePlan,
          error instanceof Error ? error.message : String(error)
        )
        eventsClosed = true
        return result
      } catch {
        // Fall through to the original error; terminal orphan sweep preserves work later.
      }
    }
    throw error
  } finally {
    if (handle && !eventsClosed && handle.state.status !== 'running' && handle.state.status !== 'awaiting-gate') {
      await handle.events.close().catch(() => undefined)
    }
  }
}
