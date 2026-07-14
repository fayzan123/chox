import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { compileRelay, renderPlan } from '../../src/artifacts/relay-compiler.js'
import { loadRelay } from '../../src/artifacts/relay-loader.js'
import { validateRelay } from '../../src/artifacts/ir.js'
import { resolvePaths } from '../../src/paths.js'
import { isValidSlug, slugify } from '../../src/slugify.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

async function writeRelay(
  dir: string,
  relay: Record<string, unknown>,
  templates: Record<string, string> = {}
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'relay.json'), JSON.stringify(relay))
  await Promise.all(Object.entries(templates).map(async ([name, contents]) => {
    await writeFile(join(dir, name), contents)
  }))
}

function oneHop(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runtime: 'claude',
    role: 'plan',
    promptTemplate: 'plan.md',
    autonomy: 'autonomous',
    produces: ['spec.md'],
    ...overrides
  }
}

describe('slugify', () => {
  test('creates a lowercase filesystem-safe slug', () => {
    expect(slugify('  Spec → Implement / Review  ')).toBe('spec-implement-review')
    expect(isValidSlug('spec-implement-review')).toBe(true)
    expect(isValidSlug('../escape')).toBe(false)
  })
})

test('relay validation reports all independent problems together', () => {
  expect(() => validateRelay({
    slug: 'Wrong Slug',
    gates: 'sometimes',
    hops: [{
      runtime: 'other',
      role: '',
      promptTemplate: '../escape.md',
      autonomy: 'wild',
      produces: ['../escape', '../escape'],
      skillRef: 'future'
    }]
  }, { slug: 'expected' })).toThrowError(/slug must[\s\S]*gates must[\s\S]*runtime must[\s\S]*role must[\s\S]*promptTemplate[\s\S]*autonomy must[\s\S]*produces\[0\][\s\S]*skillRef/)
})

test('a repo-local relay loads, compiles artifact paths, and renders exact prompts', async () => {
  const root = await makeTempDir()
  const choxHome = join(root, 'home')
  const repoRoot = join(root, 'repo')
  const relayDir = join(repoRoot, '.chox', 'relays', 'demo')
  await mkdir(relayDir, { recursive: true })
  await writeFile(join(relayDir, 'relay.json'), JSON.stringify({
    slug: 'demo',
    hops: [
      {
        runtime: 'claude',
        role: 'plan',
        promptTemplate: 'plan.md',
        autonomy: 'challenge',
        produces: ['spec.md']
      },
      {
        runtime: 'codex',
        role: 'implement',
        promptTemplate: 'implement.md',
        autonomy: 'strict',
        produces: ['result.md'],
        model: 'gpt-5.3-codex',
        interaction: 'headless'
      }
    ]
  }))
  await writeFile(join(relayDir, 'plan.md'), 'Write {{produces}} for {{repo}}')
  await writeFile(join(relayDir, 'implement.md'), 'Read {{artifact:spec.md}} exactly')

  const paths = resolvePaths({ CHOX_HOME: choxHome })
  const loaded = await loadRelay('demo', { repoRoot, paths })
  const plan = compileRelay(loaded)

  expect(plan.hops[0]?.produces).toEqual([
    '.chox-run/spec.md',
    '.chox-run/challenge-notes.md'
  ])
  expect(plan.hops[0]?.prompt).toBe(
    `Write .chox-run/spec.md, .chox-run/challenge-notes.md for ${repoRoot}`
  )
  expect(plan.hops[1]?.prompt).toBe('Read .chox-run/spec.md exactly')
  expect(plan.hops[0]).toMatchObject({ interaction: 'interactive' })
  expect(plan.hops[0]?.model).toBeUndefined()
  expect(plan.hops[1]).toMatchObject({ interaction: 'headless', model: 'gpt-5.3-codex' })
  expect(renderPlan(plan)).toContain(plan.hops[1]?.prompt)
  expect(renderPlan(plan)).toMatch(/Interaction: interactive[\s\S]*Model: CLI default/)
  expect(renderPlan(plan)).toMatch(/Interaction: headless[\s\S]*Model: gpt-5\.3-codex/)
  expect(await readFile(join(relayDir, 'plan.md'), 'utf8')).toBe('Write {{produces}} for {{repo}}')
})

test('repo-local relays shadow global relays', async () => {
  const root = await makeTempDir()
  const repoRoot = join(root, 'repo')
  const paths = resolvePaths({ CHOX_HOME: join(root, 'home') })
  const relay = { slug: 'demo', hops: [oneHop()] }
  await writeRelay(join(paths.relays, 'demo'), relay, { 'plan.md': 'global' })
  await writeRelay(join(repoRoot, '.chox', 'relays', 'demo'), relay, { 'plan.md': 'local' })

  const loaded = await loadRelay('demo', { repoRoot, paths })
  expect(loaded.templates.get('plan.md')).toBe('local')
})

test('the built-in starter resolves in an isolated home and remains byte-for-byte read-only', async () => {
  const root = await makeTempDir()
  const repoRoot = join(root, 'repo')
  const paths = resolvePaths({ CHOX_HOME: join(root, 'home') })
  const loaded = await loadRelay('spec-implement-review', { repoRoot, paths })
  expect(loaded.source).toBe('built-in')
  const before = await Promise.all([
    readFile(join(loaded.dir, 'relay.json')),
    readFile(join(loaded.dir, 'plan.md')),
    readFile(join(loaded.dir, 'implement.md')),
    readFile(join(loaded.dir, 'review.md'))
  ])

  const plan = compileRelay(loaded, { task: 'Ship café support {{repo}} without re-expanding it' })
  expect(plan.hops.map(({ runtime }) => runtime)).toEqual(['claude', 'codex', 'claude'])
  expect(plan.hops.map(({ autonomy }) => autonomy)).toEqual(['challenge', 'autonomous', 'strict'])
  expect(plan.hops[0]?.prompt).toContain('Ship café support {{repo}} without re-expanding it')
  expect(plan.hops[0]?.prompt).not.toContain(repoRoot + ' without re-expanding it')
  expect(plan.hops.every(({ prompt }) => !/{{(?!repo}})[^{}]+}}/.test(prompt))).toBe(true)

  const after = await Promise.all([
    readFile(join(loaded.dir, 'relay.json')),
    readFile(join(loaded.dir, 'plan.md')),
    readFile(join(loaded.dir, 'implement.md')),
    readFile(join(loaded.dir, 'review.md'))
  ])
  expect(after).toEqual(before)
})

test('global and repository relays shadow the built-in starter in exact precedence order', async () => {
  const root = await makeTempDir()
  const repoRoot = join(root, 'repo')
  const paths = resolvePaths({ CHOX_HOME: join(root, 'home') })
  const relay = { slug: 'spec-implement-review', hops: [oneHop()] }
  await writeRelay(join(paths.relays, 'spec-implement-review'), relay, { 'plan.md': 'global winner' })
  expect((await loadRelay('spec-implement-review', { repoRoot, paths })).source).toBe('global')

  await writeRelay(
    join(repoRoot, '.chox', 'relays', 'spec-implement-review'),
    relay,
    { 'plan.md': 'repository winner' }
  )
  const loaded = await loadRelay('spec-implement-review', { repoRoot, paths })
  expect(loaded.source).toBe('repository')
  expect(loaded.templates.get('plan.md')).toBe('repository winner')
})

test('task substitution is single-pass and task consumption errors are actionable', async () => {
  const root = await makeTempDir()
  const repoRoot = join(root, 'repo')
  const paths = resolvePaths({ CHOX_HOME: join(root, 'home') })
  const taskableDir = join(repoRoot, '.chox', 'relays', 'taskable')
  await writeRelay(taskableDir, { slug: 'taskable', hops: [oneHop()] }, {
    'plan.md': 'Task bytes:\n{{task}}\nRepo: {{repo}}'
  })
  const taskable = await loadRelay('taskable', { repoRoot, paths })
  expect(() => compileRelay(taskable)).toThrow(/--task <text>.*--task-file <path>/)
  const task = 'line 1 {{repo}} {{artifact:secret.md}} }{ "quote" \\ café\nline 2'
  const plan = compileRelay(taskable, { task })
  expect(plan.hops[0]?.prompt).toBe(`Task bytes:\n${task}\nRepo: ${repoRoot}`)

  const fixedDir = join(repoRoot, '.chox', 'relays', 'fixed')
  await writeRelay(fixedDir, { slug: 'fixed', hops: [oneHop()] }, { 'plan.md': 'Fixed purpose' })
  const fixed = await loadRelay('fixed', { repoRoot, paths })
  expect(() => compileRelay(fixed, { task: 'must not disappear' }))
    .toThrowError(new RegExp(`does not consume task input[\\s\\S]*${fixedDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/]plan\\.md`))
  expect(compileRelay(fixed).hops[0]?.prompt).toBe('Fixed purpose')
})

test.each([
  ['unknown placeholder', [oneHop()], 'Use {{mystery}}', /unknown placeholder.*mystery/],
  ['forward artifact reference', [
    oneHop({ produces: ['first.md'] }),
    oneHop({ promptTemplate: 'next.md', produces: ['second.md'] })
  ], 'Read {{artifact:second.md}}', /references artifact.*second\.md.*before/],
  ['duplicate artifacts', [
    oneHop({ produces: ['same.md'] }),
    oneHop({ promptTemplate: 'next.md', produces: ['same.md'] })
  ], 'second', /duplicate artifact.*same\.md/]
])('%s is rejected during compilation', async (_name, hops, firstTemplate, expected) => {
  const root = await makeTempDir()
  const repoRoot = join(root, 'repo')
  const relayDir = join(repoRoot, '.chox', 'relays', 'demo')
  await writeRelay(relayDir, { slug: 'demo', hops }, {
    'plan.md': firstTemplate as string,
    'next.md': 'Read {{artifact:second.md}}'
  })
  const loaded = await loadRelay('demo', {
    repoRoot,
    paths: resolvePaths({ CHOX_HOME: join(root, 'home') })
  })
  expect(() => compileRelay(loaded)).toThrowError(expected as RegExp)
})

test('a missing template names the missing file', async () => {
  const root = await makeTempDir()
  const repoRoot = join(root, 'repo')
  const relayDir = join(repoRoot, '.chox', 'relays', 'demo')
  await writeRelay(relayDir, { slug: 'demo', hops: [oneHop()] })
  await expect(loadRelay('demo', {
    repoRoot,
    paths: resolvePaths({ CHOX_HOME: join(root, 'home') })
  })).rejects.toThrow(/plan\.md/)
})

test('skillRef is rejected until composition ships', () => {
  expect(() => validateRelay({
    slug: 'demo',
    hops: [oneHop({ skillRef: 'review' })]
  }, { slug: 'demo' })).toThrow(/not supported until relay composition ships/)
})

test('model and interaction reject invalid boundary values without a model allowlist', () => {
  expect(() => validateRelay({
    slug: 'demo',
    hops: [oneHop({ model: '   ', interaction: 'ambient' })]
  }, { slug: 'demo' })).toThrowError(/model must be a non-empty string[\s\S]*interaction must be 'interactive' or 'headless'/)

  expect(validateRelay({
    slug: 'demo',
    hops: [oneHop({ model: 'vendor/model-next-2026' })]
  }, { slug: 'demo' }).hops[0]?.model).toBe('vendor/model-next-2026')
})
