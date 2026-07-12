import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import type { CompiledHop, ExecutionPlan } from '../src/artifacts/relay-compiler.js'
import { renderPlan } from '../src/artifacts/relay-compiler.js'
import { RunInterruptedError, type GateIO } from '../src/harness/gates.js'
import { executeRun } from '../src/harness/runner.js'
import { findResumableRun, saveState } from '../src/harness/run-store.js'
import { readEvents } from '../src/harness/run-events.js'
import { resolvePaths } from '../src/paths.js'
import { cleanupTempDirs, makeTempDir } from './helpers/temp.js'
import { initGitRepo } from './helpers/git.js'
import { installFakeAgents, setFakeAgentScript } from './helpers/fake-agents.js'

afterEach(cleanupTempDirs)

function makeHop(index: number, overrides: Partial<CompiledHop> = {}): CompiledHop {
  return {
    index,
    runtime: index % 2 === 0 ? 'claude' : 'codex',
    role: index === 0 ? 'plan' : 'implement',
    autonomy: 'autonomous',
    prompt: index === 0 ? 'Create .chox-run/spec.md' : 'Read .chox-run/spec.md and implement it',
    produces: [index === 0 ? '.chox-run/spec.md' : '.chox-run/result.md'],
    gated: true,
    ...overrides
  }
}

function makePlan(hops: CompiledHop[] = [makeHop(0), makeHop(1)]): ExecutionPlan {
  return { slug: 'demo', hops }
}

function scriptedGate(keys: string[], lines: string[] = [], edit?: (path: string) => Promise<void>): GateIO & {
  output: string[]
  reads: number
} {
  return {
    output: [],
    reads: 0,
    print(text) {
      this.output.push(text)
    },
    async readKey() {
      this.reads += 1
      return keys.shift() ?? 'b'
    },
    async openEditor(path) {
      await edit?.(path)
    },
    async readLine() {
      return lines.shift() ?? ''
    }
  }
}

async function invocations(path: string): Promise<Array<{ binary: string, stdin: string }>> {
  const contents = await readFile(path, 'utf8')
  return contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as {
    binary: string
    stdin: string
  })
}

async function setup() {
  const root = await makeTempDir()
  const repoRoot = await initGitRepo(root)
  const paths = resolvePaths({ CHOX_HOME: join(root, 'home') })
  const fake = await installFakeAgents(root)
  const prior = { ...process.env }
  Object.assign(process.env, fake.env)
  return {
    root,
    repoRoot,
    paths,
    fake,
    restore: () => {
      for (const key of Object.keys(process.env)) {
        if (!(key in prior)) delete process.env[key]
      }
      Object.assign(process.env, prior)
    }
  }
}

describe.sequential('runner integration', () => {
  test('a full two-hop run flows artifacts through every gate and sends exact compiled prompts', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { calls: [
        {
          stdout: [{ type: 'result', result: 'planned' }],
          artifacts: { 'spec.md': '# Plan\nBuild it\n' }
        },
        {
          stdout: [{ type: 'item.completed', item: { type: 'agent_message', text: 'implemented' } }],
          requireArtifacts: ['spec.md'],
          copyArtifacts: { 'result.md': 'spec.md' }
        }
      ] })
      const plan = makePlan()
      const io = scriptedGate(['a', 'a'])
      const result = await executeRun({
        plan,
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io,
        unattended: false
      })

      expect(result.status).toBe('completed')
      expect(io.reads).toBe(2)
      expect(await readFile(join(
        fixture.paths.runs,
        'demo',
        result.runId,
        'artifacts',
        'hop-1',
        'result.md'
      ), 'utf8')).toContain('Build it')
      const calls = await invocations(fixture.fake.logPath)
      expect(calls.map(({ stdin }) => stdin)).toEqual(plan.hops.map(({ prompt }) => prompt))
      expect(renderPlan(plan)).toContain(calls[0]?.stdin)

      const events = []
      for await (const event of readEvents(join(
        fixture.paths.runs,
        'demo',
        result.runId,
        'events.jsonl'
      ))) events.push(event.type)
      expect(events[0]).toBe('run:start')
      expect(events.filter((type) => type === 'gate:presented')).toHaveLength(2)
      expect(events.at(-1)).toBe('run:end')
    } finally {
      fixture.restore()
    }
  })

  test('editing the first artifact changes what the next hop receives', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { calls: [
        { artifacts: { 'spec.md': '# Plan\n' } },
        { requireArtifacts: ['spec.md'], copyArtifacts: { 'result.md': 'spec.md' } }
      ] })
      const io = scriptedGate(['e', 'a', 'a'], [], async (path) => appendFile(path, 'user edit\n'))
      const result = await executeRun({
        plan: makePlan(),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io,
        unattended: false
      })
      expect(await readFile(join(
        fixture.paths.runs,
        'demo',
        result.runId,
        'artifacts',
        'hop-1',
        'result.md'
      ), 'utf8')).toContain('user edit')
    } finally {
      fixture.restore()
    }
  })

  test('unattended runs never read gate input', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { artifacts: { 'spec.md': '# Plan\n' } })
      const io = scriptedGate([])
      const result = await executeRun({
        plan: makePlan([makeHop(0)]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io,
        unattended: true
      })
      expect(result.status).toBe('completed')
      expect(io.reads).toBe(0)
    } finally {
      fixture.restore()
    }
  })

  test('a non-zero agent exit presents a blocking failure gate', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, {
        artifacts: { 'spec.md': '# partial\n' },
        exitCode: 7
      })
      const io = scriptedGate(['b'])
      const result = await executeRun({
        plan: makePlan([makeHop(0)]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io,
        unattended: false
      })
      expect(result.status).toBe('aborted')
      expect(io.output.join('\n')).toMatch(/exited with code 7.*approval is blocked/i)
    } finally {
      fixture.restore()
    }
  })

  test('an interruption at a gate resumes that same gate without rerunning the agent', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { artifacts: { 'spec.md': '# Plan\n' } })
      const interrupted = scriptedGate([])
      interrupted.readKey = async () => { throw new RunInterruptedError() }
      await expect(executeRun({
        plan: makePlan([makeHop(0)]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io: interrupted,
        unattended: false
      })).rejects.toBeInstanceOf(RunInterruptedError)

      const resume = await findResumableRun('demo', fixture.paths)
      expect(resume?.state.status).toBe('awaiting-gate')
      if (!resume) throw new Error('expected resumable run')
      const result = await executeRun({
        plan: makePlan([makeHop(0, { prompt: 'changed after interruption' })]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io: scriptedGate(['a']),
        unattended: false,
        resume
      })
      expect(result.status).toBe('completed')
      expect(await invocations(fixture.fake.logPath)).toHaveLength(1)
    } finally {
      fixture.restore()
    }
  })

  test('resuming a crashed running hop reruns it from the persisted plan', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { artifacts: { 'spec.md': '# Plan\n' } })
      const interrupted = scriptedGate([])
      interrupted.readKey = async () => { throw new RunInterruptedError() }
      const original = makePlan([makeHop(0)])
      await expect(executeRun({
        plan: original,
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io: interrupted,
        unattended: false
      })).rejects.toBeInstanceOf(RunInterruptedError)
      const resume = await findResumableRun('demo', fixture.paths)
      if (!resume) throw new Error('expected resumable run')
      await saveState(resume, { status: 'running', gate: undefined })

      const result = await executeRun({
        plan: makePlan([makeHop(0, { prompt: 'new relay prompt must not be used' })]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io: scriptedGate(['a']),
        unattended: false,
        resume
      })
      expect(result.status).toBe('completed')
      const calls = await invocations(fixture.fake.logPath)
      expect(calls).toHaveLength(2)
      expect(calls[1]?.stdin).toBe(original.hops[0]?.prompt)
    } finally {
      fixture.restore()
    }
  })

  test('challenge mode automatically re-prompts exactly once for missing notes', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { calls: [
        { artifacts: { 'spec.md': '# Plan\n' } },
        { artifacts: { 'challenge-notes.md': 'No deviations.\n' } }
      ] })
      const challenge = makeHop(0, {
        autonomy: 'challenge',
        produces: ['.chox-run/spec.md', '.chox-run/challenge-notes.md']
      })
      const result = await executeRun({
        plan: makePlan([challenge]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io: scriptedGate([]),
        unattended: true
      })
      expect(result.status).toBe('completed')
      const calls = await invocations(fixture.fake.logPath)
      expect(calls).toHaveLength(2)
      expect(calls[1]?.stdin).toMatch(/Required challenge notes/)
    } finally {
      fixture.restore()
    }
  })

  test('redirect reruns the hop with the appended user note', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { artifacts: { 'spec.md': '# Plan\n' } })
      const result = await executeRun({
        plan: makePlan([makeHop(0)]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io: scriptedGate(['r', 'a'], ['Use the smaller API']),
        unattended: false
      })
      expect(result.status).toBe('completed')
      const calls = await invocations(fixture.fake.logPath)
      expect(calls).toHaveLength(2)
      expect(calls[1]?.stdin).toContain('## User redirect note\nUse the smaller API')
    } finally {
      fixture.restore()
    }
  })
})
