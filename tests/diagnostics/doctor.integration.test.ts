import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { buildBundle, runDoctor, type Probe } from '../../src/doctor.js'
import { resolvePaths } from '../../src/paths.js'
import { redact } from '../../src/redact.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { installFakeAgents } from '../helpers/fake-agents.js'

afterEach(cleanupTempDirs)

test('redaction covers raw, dash-encoded, and username path-segment forms', () => {
  const homeDir = '/Users/fayzan.malik'
  const input = [
    '/Users/fayzan.malik/private/file',
    '-Users-fayzan-malik-Documents-GitHub-chox',
    '/tmp/fayzan.malik/cache'
  ].join('\n')
  const output = redact(input, { homeDir })
  expect(output).not.toContain(homeDir)
  expect(output).not.toContain('-Users-fayzan-malik')
  expect(output).not.toContain('/fayzan.malik/')
  expect(output).toContain('~')
})

describe.sequential('doctor', () => {
  test('probes a fabricated local environment with fake agent binaries', async () => {
    const root = await makeTempDir()
    const fakeHome = join(root, 'user-home')
    await mkdir(join(fakeHome, '.claude', 'projects'), { recursive: true })
    await mkdir(join(fakeHome, '.codex', 'sessions'), { recursive: true })
    const fake = await installFakeAgents(root)
    const env = { ...fake.env, HOME: fakeHome, USERPROFILE: fakeHome, CHOX_HOME: join(root, 'chox-home') }
    const paths = resolvePaths(env)
    const probes = await runDoctor({ paths, env })

    expect(probes.find(({ name }) => name === 'Node version')).toMatchObject({ ok: true, critical: true })
    expect(probes.find(({ name }) => name === 'Claude Code')).toMatchObject({ ok: true, critical: false })
    expect(probes.find(({ name }) => name === 'Codex CLI')).toMatchObject({ ok: true, critical: false })
    expect(probes.find(({ name }) => name === 'Claude sessions')).toMatchObject({ ok: true })
    expect(probes.find(({ name }) => name === 'Codex sessions')).toMatchObject({ ok: true })
    expect(probes.find(({ name }) => name === 'Substrate')?.detail).toMatch(/Phase 1b/)
  })

  test('the bundle removes raw and dash-encoded home paths', () => {
    const homeDir = '/Users/fayzan.malik'
    const encoded = '-Users-fayzan-malik'
    const probes: Probe[] = [{
      name: 'Redaction fixture',
      ok: false,
      critical: false,
      detail: `${homeDir}/secret ${encoded}-project /tmp/fayzan.malik/cache`
    }]
    const bundle = buildBundle(probes, { homeDir })
    expect(bundle).not.toContain(homeDir)
    expect(bundle).not.toContain(encoded)
    expect(bundle).not.toContain('/fayzan.malik/')
    expect(() => JSON.parse(bundle)).not.toThrow()
  })

  test('a run-heavy Chox home contributes counts but never prompt content', async () => {
    const root = await makeTempDir()
    const homeDir = join(root, 'user')
    const choxHome = join(root, 'chox-home')
    const runDir = join(choxHome, 'runs', 'demo', 'run-1')
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'plan.json'), JSON.stringify({ prompt: 'TOP SECRET PROMPT' }))
    await writeFile(join(runDir, 'run.json'), '{}')
    const fake = await installFakeAgents(root)
    const env = { ...fake.env, HOME: homeDir, USERPROFILE: homeDir, CHOX_HOME: choxHome }
    const probes = await runDoctor({ paths: resolvePaths(env), env })
    const bundle = buildBundle(probes, { homeDir })
    expect(bundle).not.toContain('TOP SECRET PROMPT')
    expect(bundle).toMatch(/unreadable run/i)
  })
})
