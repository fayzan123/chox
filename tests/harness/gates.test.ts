import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import type { CompiledHop } from '../../src/artifacts/relay-compiler.js'
import { createTerminalGateIO, presentGate, type GateIO } from '../../src/harness/gates.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

const hop: CompiledHop = {
  index: 0,
  runtime: 'claude',
  role: 'plan',
  autonomy: 'challenge',
  prompt: 'plan',
  produces: ['.chox-run/spec.md'],
  gated: true
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
    artifactPaths: [{ name: 'spec.md', path: '/tmp/spec.md', summary: '# Plan' }],
    deviations: [],
    blocking: false,
    io
  })
  expect(result).toEqual({ action: 'approve' })
  expect(io.output.join('\n')).toMatch(/spec\.md.*# Plan[\s\S]*\[a\]pprove/)
})

test('blocking gates hide approve and label advisory deviations', async () => {
  const io = scriptedIO(['b'])
  const result = await presentGate({
    hop,
    artifactPaths: [],
    deviations: [
      { kind: 'unlisted-command', advisory: true, detail: 'npm surprise' },
      { kind: 'missing-artifact', advisory: false, detail: 'spec missing' }
    ],
    blocking: true,
    io
  })
  expect(result).toEqual({ action: 'abort' })
  expect(io.allowed[0]).not.toContain('a')
  expect(io.output.join('\n')).toMatch(/spec missing[\s\S]*\[advisory\].*npm surprise/)
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
