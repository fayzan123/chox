#!/usr/bin/env node

import { stat, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { compileRelay, renderPlan } from '../src/artifacts/relay-compiler.js'
import { loadRelay } from '../src/artifacts/relay-loader.js'
import { buildBundle, runDoctor } from '../src/doctor.js'
import { ChoxError, ChoxUsageError } from '../src/errors.js'
import { createTerminalGateIO, RunInterruptedError, type GateIO } from '../src/harness/gates.js'
import { executeRun } from '../src/harness/runner.js'
import { findResumableRun } from '../src/harness/run-store.js'
import { resolvePaths } from '../src/paths.js'

const usage = `Usage:
  chox run <slug> [--dry-run] [--resume] [--unattended]
  chox doctor [--bundle]
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
  if (result.branch) {
    ctx.stdout(
      `Run ${result.status}. Work is preserved on branch ${result.branch}.\n` +
      `Review it, then merge with: git merge ${result.branch}\n`
    )
  }
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
    if (command === 'doctor') return await doctorCommand(rest, ctx)
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
