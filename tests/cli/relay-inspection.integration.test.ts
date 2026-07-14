import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { runCli, type CliContext } from '../../bin/chox.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { initGitRepo } from '../helpers/git.js'

afterEach(cleanupTempDirs)

function context(overrides: Partial<CliContext> = {}) {
  const stdout: string[] = []
  const stderr: string[] = []
  const ctx: CliContext = {
    cwd: process.cwd(),
    env: { ...process.env },
    stdinIsTTY: false,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    ...overrides
  }
  return { ctx, stdout, stderr }
}

async function writeStarterShadow(baseDir: string, prompt: string): Promise<void> {
  const dir = join(baseDir, 'spec-implement-review')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'relay.json'), JSON.stringify({
    slug: 'spec-implement-review',
    gates: 'none',
    hops: [{
      runtime: 'codex',
      role: 'custom',
      promptTemplate: 'custom.md',
      autonomy: 'autonomous',
      produces: ['custom.md']
    }]
  }))
  await writeFile(join(dir, 'custom.md'), prompt)
}

test('relay list/show discover the packed-style built-in with summary-first human and JSON output', async () => {
  const root = await makeTempDir()
  const repoRoot = await initGitRepo(root)
  const env = { ...process.env, CHOX_HOME: join(root, 'chox-home') }

  const list = context({ cwd: repoRoot, env })
  expect(await runCli(['relay', 'list'], list.ctx)).toBe(0)
  expect(list.stdout.join('')).toMatch(
    /spec-implement-review · built-in[\s\S]*3 hop\(s\): claude → codex → claude[\s\S]*task required/
  )

  const machine = context({ cwd: repoRoot, env })
  expect(await runCli(['relay', 'list', '--json'], machine.ctx)).toBe(0)
  const parsed = JSON.parse(machine.stdout.join('')) as {
    schemaVersion: number
    relays: Array<{
      slug: string
      source: string
      taskRequired: boolean
      hops: Array<{ runtime: string }>
      shadowedSources: string[]
    }>
  }
  expect(parsed.schemaVersion).toBe(1)
  expect(parsed.relays).toContainEqual(expect.objectContaining({
    slug: 'spec-implement-review',
    source: 'built-in',
    taskRequired: true,
    shadowedSources: [],
    hops: [
      expect.objectContaining({ runtime: 'claude' }),
      expect.objectContaining({ runtime: 'codex' }),
      expect.objectContaining({ runtime: 'claude' })
    ]
  }))

  const summary = context({ cwd: repoRoot, env })
  expect(await runCli(['relay', 'show', 'spec-implement-review'], summary.ctx)).toBe(0)
  expect(summary.stdout.join('')).toMatch(/Source: built-in[\s\S]*Gates: all-boundaries[\s\S]*Task: required/)
  expect(summary.stdout.join('')).toContain('Prompt: # Plan the task')
  expect(summary.stdout.join('')).not.toContain('turn the task below into an')

  const prompts = context({ cwd: repoRoot, env })
  expect(await runCli([
    'relay', 'show', 'spec-implement-review', '--prompts', '--json'
  ], prompts.ctx)).toBe(0)
  const shown = JSON.parse(prompts.stdout.join('')) as {
    relay: { source: string, hops: Array<{ prompt?: string }> }
  }
  expect(shown.relay.source).toBe('built-in')
  expect(shown.relay.hops[0]?.prompt).toContain('turn the task below into an')
  expect(shown.relay.hops[0]?.prompt).toContain('{{task}}')
})

test('relay catalog reports repository then global then built-in shadowing winners', async () => {
  const root = await makeTempDir()
  const repoRoot = await initGitRepo(root)
  const choxHome = join(root, 'chox-home')
  const env = { ...process.env, CHOX_HOME: choxHome }
  await writeStarterShadow(join(choxHome, 'relays'), 'Global prompt')

  const global = context({ cwd: repoRoot, env })
  expect(await runCli(['relay', 'list', '--json'], global.ctx)).toBe(0)
  expect(JSON.parse(global.stdout.join('')).relays).toContainEqual(expect.objectContaining({
    slug: 'spec-implement-review',
    source: 'global',
    shadowedSources: ['built-in']
  }))

  await writeStarterShadow(join(repoRoot, '.chox', 'relays'), 'Repository task:\n{{task}}')
  const repository = context({ cwd: repoRoot, env })
  expect(await runCli(['relay', 'list'], repository.ctx)).toBe(0)
  expect(repository.stdout.join('')).toMatch(
    /winner repository, shadows global, built-in[\s\S]*1 hop\(s\): codex[\s\S]*task required/
  )

  const show = context({ cwd: repoRoot, env })
  expect(await runCli(['relay', 'show', 'spec-implement-review', '--json'], show.ctx)).toBe(0)
  expect(JSON.parse(show.stdout.join('')).relay).toMatchObject({
    source: 'repository',
    gates: 'none',
    taskRequired: true
  })
})
