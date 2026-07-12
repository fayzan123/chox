import { constants } from 'node:fs'
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { arch, homedir, platform, release } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

import { ensureChoxHome, type ChoxPaths } from './paths.js'
import { redact } from './redact.js'
import { runCommand } from './system/command.js'

export interface Probe {
  name: string
  ok: boolean
  detail: string
  critical: boolean
}

function nodeVersionHealthy(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 22 || (major === 22 && minor >= 13)
}

async function binaryProbe(
  binary: string,
  name: string,
  installUrl: string,
  env: NodeJS.ProcessEnv
): Promise<Probe> {
  const result = await runCommand(binary, ['--version'], {
    cwd: process.cwd(),
    env,
    allowFailure: true
  })
  const detail = (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/).at(-1)
  return result.code === 0
    ? { name, ok: true, critical: false, detail: detail || 'present' }
    : {
        name,
        ok: false,
        critical: false,
        detail: `not found or unhealthy — install from ${installUrl}`
      }
}

async function directoryProbe(name: string, path: string): Promise<Probe> {
  try {
    await access(path, constants.R_OK)
    return { name, ok: true, critical: false, detail: 'present and readable' }
  } catch {
    return { name, ok: false, critical: false, detail: 'not found or not readable (informational for Phase 1b)' }
  }
}

async function runHealth(paths: ChoxPaths): Promise<{ orphans: number, unreadable: number }> {
  const active = new Set<string>()
  let unreadable = 0
  let slugs: string[] = []
  try {
    slugs = await readdir(paths.runs)
  } catch {
    // Empty home.
  }
  for (const slug of slugs) {
    let runs: string[] = []
    try {
      runs = await readdir(join(paths.runs, slug))
    } catch {
      unreadable += 1
      continue
    }
    for (const run of runs) {
      try {
        const value = JSON.parse(await readFile(join(paths.runs, slug, run, 'run.json'), 'utf8')) as {
          status?: unknown
          worktreePath?: unknown
        }
        if (typeof value.status !== 'string' || typeof value.worktreePath !== 'string') {
          throw new Error('invalid state')
        }
        if (value.status === 'running' || value.status === 'awaiting-gate') {
          active.add(resolve(value.worktreePath))
        }
      } catch {
        unreadable += 1
      }
    }
  }
  let worktrees: string[] = []
  try {
    worktrees = await readdir(paths.worktrees)
  } catch {
    // Empty home.
  }
  const orphans = worktrees.filter((name) => !active.has(resolve(paths.worktrees, name))).length
  return { orphans, unreadable }
}

export async function runDoctor(opts: {
  paths: ChoxPaths
  env: NodeJS.ProcessEnv
}): Promise<Probe[]> {
  const probes: Probe[] = []
  probes.push({
    name: 'Node version',
    ok: nodeVersionHealthy(process.versions.node),
    critical: true,
    detail: process.versions.node
  })
  try {
    await import('node:sqlite')
    probes.push({ name: 'node:sqlite', ok: true, critical: true, detail: 'importable' })
  } catch {
    probes.push({
      name: 'node:sqlite',
      ok: false,
      critical: true,
      detail: 'not importable — install Node 22.13 or newer'
    })
  }

  probes.push(await binaryProbe(
    'claude',
    'Claude Code',
    'https://docs.anthropic.com/en/docs/claude-code',
    opts.env
  ))
  probes.push(await binaryProbe(
    'codex',
    'Codex CLI',
    'https://developers.openai.com/codex/cli',
    opts.env
  ))

  const userHome = opts.env.HOME?.trim() || opts.env.USERPROFILE?.trim() || homedir()
  probes.push(await directoryProbe('Claude sessions', join(userHome, '.claude', 'projects')))
  probes.push(await directoryProbe('Codex sessions', join(userHome, '.codex', 'sessions')))

  try {
    await ensureChoxHome(opts.paths)
    const probePath = join(opts.paths.home, `.doctor-write-${randomBytes(4).toString('hex')}`)
    await writeFile(probePath, '')
    await rm(probePath, { force: true })
    probes.push({ name: 'Chox home', ok: true, critical: true, detail: 'writable' })
  } catch {
    probes.push({
      name: 'Chox home',
      ok: false,
      critical: true,
      detail: 'not writable — set CHOX_HOME to a writable directory'
    })
  }

  const health = await runHealth(opts.paths)
  probes.push({
    name: 'Run storage',
    ok: health.orphans === 0 && health.unreadable === 0,
    critical: false,
    detail: `${health.orphans} orphaned worktrees; ${health.unreadable} unreadable run directories`
  })
  probes.push({
    name: 'Substrate',
    ok: true,
    critical: false,
    detail: 'not initialized — ships in Phase 1b'
  })
  return probes
}

export function buildBundle(probes: Probe[], opts: { homeDir: string }): string {
  const allowlisted = {
    generatedAt: new Date().toISOString(),
    system: {
      platform: platform(),
      release: release(),
      arch: arch(),
      node: process.versions.node
    },
    probes: probes.map(({ name, ok, detail, critical }) => ({ name, ok, detail, critical }))
  }
  return redact(`${JSON.stringify(allowlisted, null, 2)}\n`, opts)
}
