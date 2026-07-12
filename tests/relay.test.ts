import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { compileRelay, renderPlan } from '../src/artifacts/relay-compiler.js'
import { loadRelay } from '../src/artifacts/relay-loader.js'
import { validateRelay } from '../src/artifacts/ir.js'
import { resolvePaths } from '../src/paths.js'
import { isValidSlug, slugify } from '../src/slugify.js'
import { cleanupTempDirs, makeTempDir } from './helpers/temp.js'

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
        produces: ['result.md']
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
  expect(renderPlan(plan)).toContain(plan.hops[1]?.prompt)
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
