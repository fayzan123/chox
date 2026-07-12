import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { runCli, type CliContext } from '../../bin/chox.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { initGitRepo } from '../helpers/git.js'
import { installFakeAgents } from '../helpers/fake-agents.js'

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

test('no arguments print usage successfully', async () => {
  const output = context()
  expect(await runCli([], output.ctx)).toBe(0)
  expect(output.stdout.join('')).toContain('chox run <slug>')
})

test('--version prints the package version', async () => {
  const output = context()
  expect(await runCli(['--version'], output.ctx)).toBe(0)
  expect(output.stdout.join('')).toMatch(/^0\.0\.0/)
})

test.each([
  ['unknown command', ['future']],
  ['unknown run flag', ['run', 'demo', '--future']],
  ['missing run slug', ['run']]
])('%s exits 2 with usage guidance', async (_name, args) => {
  const output = context()
  expect(await runCli(args, output.ctx)).toBe(2)
  expect(output.stderr.join('')).toMatch(/usage|unknown|requires/i)
})

test('a non-TTY attended run fails before creating a worktree', async () => {
  const root = await makeTempDir()
  const repoRoot = await initGitRepo(root)
  const relayDir = join(repoRoot, '.chox', 'relays', 'demo')
  await mkdir(relayDir, { recursive: true })
  await writeFile(join(relayDir, 'relay.json'), JSON.stringify({
    slug: 'demo',
    hops: [{
      runtime: 'claude',
      role: 'plan',
      promptTemplate: 'plan.md',
      autonomy: 'autonomous',
      produces: []
    }]
  }))
  await writeFile(join(relayDir, 'plan.md'), 'Plan safely')
  const choxHome = join(root, 'chox-home')
  const output = context({
    cwd: repoRoot,
    env: { ...process.env, CHOX_HOME: choxHome },
    stdinIsTTY: false
  })

  expect(await runCli(['run', 'demo'], output.ctx)).toBe(1)
  expect(output.stderr.join('')).toMatch(/TTY.*--unattended/i)
  await expect(readdir(join(choxHome, 'worktrees'))).rejects.toThrow()
})

test('doctor reports a healthy fabricated environment and writes a redacted bundle', async () => {
  const root = await makeTempDir()
  const home = join(root, 'user.with-dot')
  await mkdir(join(home, '.claude', 'projects'), { recursive: true })
  await mkdir(join(home, '.codex', 'sessions'), { recursive: true })
  const fake = await installFakeAgents(root)
  const output = context({
    cwd: root,
    env: {
      ...fake.env,
      HOME: home,
      USERPROFILE: home,
      CHOX_HOME: join(root, 'chox-home')
    }
  })

  expect(await runCli(['doctor', '--bundle'], output.ctx)).toBe(0)
  const bundle = await readFile(join(root, 'chox-doctor-bundle.json'), 'utf8')
  expect(bundle).not.toContain(home)
  expect(bundle).not.toContain(home.replace(/[\\/.]/g, '-'))
  expect(output.stdout.join('')).toContain('Diagnostic bundle written')
})
