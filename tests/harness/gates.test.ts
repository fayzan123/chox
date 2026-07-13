import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, expect, test, vi } from 'vitest'

import type { CompiledHop } from '../../src/artifacts/relay-compiler.js'
import {
  createTerminalGateIO,
  presentGate,
  RunInterruptedError,
  summarizeArtifact,
  type GateIO
} from '../../src/harness/gates.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

const hop: CompiledHop = {
  index: 0,
  runtime: 'claude',
  role: 'plan',
  autonomy: 'challenge',
  prompt: 'plan',
  produces: ['.chox-run/spec.md'],
  gated: true,
  interaction: 'headless'
}

function scriptedIO(keys: string[], opts: {
  lines?: string[]
  edit?: (path: string) => Promise<void>
} = {}): GateIO & { output: string[], allowed: string[][] } {
  const output: string[] = []
  const allowed: string[][] = []
  const lines = [...(opts.lines ?? [])]
  return {
    output,
    allowed,
    print(text) {
      output.push(text)
    },
    async readKey(_prompt, choices) {
      allowed.push(choices)
      return keys.shift() ?? 'b'
    },
    async openEditor(path) {
      await opts.edit?.(path)
    },
    async readLine() {
      return lines.shift() ?? ''
    }
  }
}

test('approve returns immediately from a concise gate', async () => {
  const io = scriptedIO(['a'])
  const result = await presentGate({
    hop,
    artifactPaths: [{
      name: 'spec.md',
      path: '/tmp/spec.md',
      relativePath: '.chox-run/spec.md',
      summary: '# Plan'
    }],
    deviations: [],
    blocking: false,
    io
  })
  expect(result).toEqual({ action: 'approve' })
  expect(io.output.join('\n')).toMatch(/spec\.md.*# Plan[\s\S]*\[a\]pprove/)
  expect(io.output).toContain('Action: a → approve')
  expect(io.output[0]).toMatchInlineSnapshot(`
    "Gate after hop 1 (plan)
    Artifacts:
      spec.md — # Plan
        .chox-run/spec.md
    Files changed this hop: none
    [a]pprove [e]dit [r]edirect a[b]ort"
  `)
})

test('blocking gates hide approve and label advisory deviations', async () => {
  const io = scriptedIO(['b'])
  const result = await presentGate({
    hop,
    artifactPaths: [],
    deviations: [
      { kind: 'unlisted-command', advisory: true, detail: 'npm surprise' },
      { kind: 'unlisted-command', advisory: true, detail: 'node /tmp/worktree/tool.js' },
      { kind: 'unlisted-command', advisory: true, detail: 'git status' },
      { kind: 'missing-artifact', advisory: false, detail: 'spec missing' }
    ],
    blocking: true,
    footprint: [{ path: 'src/index.ts', operation: 'modify' }],
    worktree: '/tmp/worktree',
    io
  })
  expect(result).toEqual({ action: 'abort' })
  expect(io.allowed[0]).not.toContain('a')
  expect(io.output.join('\n')).toMatch(/Files changed this hop: 1 modified \(src\/index\.ts\)/)
  expect(io.output.join('\n')).toMatch(/spec missing[\s\S]*\[advisory\].*npm surprise/)
  expect(io.output.join('\n')).not.toContain('/tmp/worktree')
  expect(io.output.join('\n')).toContain('…and 1 more advisory command observations')
  expect(io.output).toContain('Action: b → abort')
})

test('edit opens the artifact and re-presents before approval', async () => {
  const root = await makeTempDir()
  const artifact = join(root, 'spec.md')
  await mkdir(root, { recursive: true })
  await writeFile(artifact, '# Before\n')
  const io = scriptedIO(['e', 'a'], {
    edit: async (path) => appendFile(path, 'edited\n')
  })
  const result = await presentGate({
    hop,
    artifactPaths: [{ name: 'spec.md', path: artifact, summary: '# Before' }],
    deviations: [],
    blocking: false,
    io
  })
  expect(result).toEqual({ action: 'approve' })
  expect(io.allowed).toHaveLength(2)
  expect(io.output.join('\n')).toContain('Opening spec.md in $EDITOR…')
})

test('redirect captures the user note for a runner retry', async () => {
  const io = scriptedIO(['r'], { lines: ['Use the smaller API'] })
  await expect(presentGate({
    hop,
    artifactPaths: [],
    deviations: [],
    blocking: false,
    io
  })).resolves.toEqual({ action: 'redirect', note: 'Use the smaller API' })
  expect(io.output).toContain('Action: r → redirect')
})

test('invalid keys are echoed with a short hint before a valid action', async () => {
  const io = scriptedIO(['x', 'a'])
  await expect(presentGate({
    hop,
    artifactPaths: [],
    deviations: [],
    blocking: false,
    io
  })).resolves.toEqual({ action: 'approve' })
  expect(io.output.join('\n')).toMatch(/Action: x → invalid[\s\S]*Choose a, e, r, b\.[\s\S]*Action: a → approve/)
})

test('artifact summaries are concise and specialize manifest JSON', async () => {
  const root = await makeTempDir()
  const manifest = join(root, 'manifest.json')
  const generic = join(root, 'data.json')
  const markdown = join(root, 'long.md')
  await writeFile(manifest, JSON.stringify({
    files: { create: ['a', 'b', 'c'], modify: ['d'], delete: [] },
    commands: ['npm test', 'npm run build']
  }))
  await writeFile(generic, JSON.stringify({ private: 'value' }))
  await writeFile(markdown, `# ${'A'.repeat(120)}\n`)

  expect(await summarizeArtifact(manifest)).toBe('3 create, 1 modify, 0 delete, 2 commands')
  expect(await summarizeArtifact(generic)).toMatch(/^\d+ bytes$/)
  expect((await summarizeArtifact(markdown)).length).toBeLessThanOrEqual(80)
})

test('terminal key reads restore raw mode, remove listeners, and pause stdin', async () => {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode(mode: boolean): void
  }
  const output = new PassThrough() as PassThrough & { isTTY: boolean }
  input.isTTY = true
  output.isTTY = true
  input.setRawMode = vi.fn()
  const io = createTerminalGateIO({}, { input, output })

  const key = io.readKey('Action: ', ['a'])
  input.write('a')
  await expect(key).resolves.toBe('a')
  expect(input.setRawMode).toHaveBeenNthCalledWith(1, true)
  expect(input.setRawMode).toHaveBeenLastCalledWith(false)
  expect(input.listenerCount('data')).toBe(0)
  expect(input.isPaused()).toBe(true)
  input.destroy()
  output.destroy()
})

test('terminal interruption also restores raw mode and pauses stdin', async () => {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode(mode: boolean): void
  }
  const output = new PassThrough() as PassThrough & { isTTY: boolean }
  input.isTTY = true
  output.isTTY = true
  input.setRawMode = vi.fn()
  const io = createTerminalGateIO({}, { input, output })

  const key = io.readKey('Action: ', ['a'])
  input.write('\u0003')
  await expect(key).rejects.toBeInstanceOf(RunInterruptedError)
  expect(input.setRawMode).toHaveBeenLastCalledWith(false)
  expect(input.listenerCount('data')).toBe(0)
  expect(input.isPaused()).toBe(true)
  input.destroy()
  output.destroy()
})

test('the configured editor is spawned as an argv array and can edit a path with spaces', async () => {
  const root = await makeTempDir()
  const editor = join(root, 'fake editor.mjs')
  const artifact = join(root, 'artifact with spaces.md')
  await writeFile(editor, [
    "import { appendFile } from 'node:fs/promises'",
    "await appendFile(process.argv.at(-1), 'edited by fake editor\\n')"
  ].join('\n'))
  await writeFile(artifact, '# Original\n')
  const io = createTerminalGateIO({
    EDITOR: `"${process.execPath}" "${editor}"`
  })

  await io.openEditor(artifact)
  expect(await readFile(artifact, 'utf8')).toContain('edited by fake editor')
})
