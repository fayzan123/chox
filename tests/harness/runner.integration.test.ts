import { appendFile, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import type { CompiledHop, ExecutionPlan } from '../../src/artifacts/relay-compiler.js'
import { renderPlan } from '../../src/artifacts/relay-compiler.js'
import { RunInterruptedError, type GateIO } from '../../src/harness/gates.js'
import { executeRun } from '../../src/harness/runner.js'
import { findResumableRun, saveState } from '../../src/harness/run-store.js'
import { readEvents } from '../../src/harness/run-events.js'
import { resolvePaths } from '../../src/paths.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'
import { initGitRepo } from '../helpers/git.js'
import { installFakeAgents, setFakeAgentScript } from '../helpers/fake-agents.js'

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
    interaction: 'headless',
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

async function invocations(path: string): Promise<Array<{
  binary: string
  args: string[]
  stdin: string
  cwd: string
  interactive: boolean
}>> {
  const contents = await readFile(path, 'utf8')
  return contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as {
    binary: string
    args: string[]
    stdin: string
    cwd: string
    interactive: boolean
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
          stdout: [
            { type: 'system', subtype: 'init', model: 'claude-actual' },
            { type: 'result', result: 'planned', usage: { input_tokens: 20, output_tokens: 5 } }
          ],
          artifacts: { 'spec.md': '# Plan\nBuild it\n' },
          files: { 'plan-output.txt': 'planned\n' }
        },
        {
          stdout: [
            { type: 'thread.started', thread_id: 'thread-1', model: 'gpt-pinned' },
            { type: 'item.completed', item: { type: 'agent_message', text: 'implemented' } },
            { type: 'turn.completed', usage: { input_tokens: 30, cached_input_tokens: 10, output_tokens: 8 } }
          ],
          requireArtifacts: ['spec.md'],
          copyArtifacts: { 'result.md': 'spec.md' },
          files: { 'src/implementation.ts': 'export const done = true\n' }
        }
      ] })
      const plan = makePlan([makeHop(0), makeHop(1, { model: 'gpt-pinned' })])
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

      const transcript = io.output.join('\n')
      expect(transcript).toMatch(/Starting Chox run demo[\s\S]*Worktree: .*demo-[^\n]+[\s\S]*Your repo is untouched/)
      const worktreePath = transcript.match(/^Worktree: (.+)$/m)?.[1]
      expect(worktreePath).toBeTruthy()
      expect(transcript.split(worktreePath as string)).toHaveLength(2)
      expect(transcript).toMatch(/Hop 1\/2 · plan · claude 1\.0\.0 · model CLI default · autonomy autonomous · headless/)
      expect(transcript).toMatch(/Hop 1\/2 · 0s elapsed · 0 events · waiting for agent output/)
      expect(transcript).toMatch(/Files changed this hop: 1 created \(plan-output\.txt\)/)
      expect(transcript).toMatch(/Action: a → approve[\s\S]*Approved\. Continuing to hop 2\/2 \(implement\)…/)
      expect(transcript).toMatch(/Approved\. Continuing[\s\S]*Files changed this hop: 1 created \(src\/implementation\.ts\)/)
      expect(transcript).toMatch(/Run completed[\s\S]*tokens 20 in, 5 out[\s\S]*tokens 30 in, 10 cached, 8 out/)
      expect(transcript).toMatch(/Files changed overall: 2 created[\s\S]*Merge: git merge chox\/demo\//)

      const events: Array<Record<string, unknown>> = []
      for await (const event of readEvents(join(
        fixture.paths.runs,
        'demo',
        result.runId,
        'events.jsonl'
      ))) events.push(event)
      expect(events[0]?.type).toBe('run:start')
      expect(events.filter(({ type }) => type === 'gate:presented')).toHaveLength(2)
      expect(events.at(-1)?.type).toBe('run:end')
      expect(events.find(({ type }) => type === 'hop:start')).toMatchObject({
        interaction: 'headless',
        model: 'CLI default'
      })
      expect(events).toContainEqual(expect.objectContaining({
        type: 'agent:event',
        event: { kind: 'session', model: 'claude-actual' }
      }))
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
      const [call] = await invocations(fixture.fake.logPath)
      expect(call?.interactive).toBe(false)
    } finally {
      fixture.restore()
    }
  })

  test('--unattended forces a declared interactive hop to run headlessly', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { artifacts: { 'spec.md': '# Plan\n' } })
      const declaredInteractive = makeHop(0, { interaction: 'interactive' })
      const result = await executeRun({
        plan: makePlan([declaredInteractive]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io: scriptedGate([]),
        unattended: true
      })
      expect(result.status).toBe('completed')
      const [call] = await invocations(fixture.fake.logPath)
      expect(call).toMatchObject({ interactive: false, stdin: declaredInteractive.prompt })
      expect(call?.args).toContain('-p')
    } finally {
      fixture.restore()
    }
  })

  test('an interactive hop uses the native session then runs artifact, footprint, and gate checks', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, {
        artifacts: { 'spec.md': '# Interactive plan\n' },
        files: { 'interactive-output.txt': 'done\n' }
      })
      const interactive = makeHop(0, {
        interaction: 'interactive',
        model: 'claude-pinned'
      })
      const io = scriptedGate(['a'])
      const result = await executeRun({
        plan: makePlan([interactive]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io,
        unattended: false
      })
      expect(result.status).toBe('completed')
      const [call] = await invocations(fixture.fake.logPath)
      expect(call?.interactive).toBe(true)
      expect(call?.cwd).toContain('demo-')
      expect(call?.args).toContain(interactive.prompt)
      expect(call?.args).toContain('claude-pinned')
      expect(call?.args).not.toContain('--dangerously-skip-permissions')
      const transcript = io.output.join('\n')
      const nativeWindow = transcript.slice(
        transcript.indexOf('Opening your claude session'),
        transcript.indexOf('Hop 1 done')
      )
      expect(nativeWindow).not.toContain('elapsed')
      expect(transcript).toContain('Files changed this hop: 1 created (interactive-output.txt)')
      expect(transcript).toContain('tokens n/a (interactive session)')
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
      expect(io.output.join('\n')).toContain(`Aborting; work preserved on branch ${result.branch}…`)
      expect(io.output.join('\n')).toContain('Inspect: git show --stat')
      expect(io.output.join('\n')).not.toContain('Merge: git merge')
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
      const legacyPlan = JSON.parse(await readFile(join(resume.dir, 'plan.json'), 'utf8')) as {
        hops: Array<Record<string, unknown>>
      }
      delete legacyPlan.hops[0]?.interaction
      await writeFile(join(resume.dir, 'plan.json'), JSON.stringify(legacyPlan))

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
      expect(calls[1]?.interactive).toBe(false)
    } finally {
      fixture.restore()
    }
  })

  test('resuming a run whose plan.json is missing fails the run instead of completing it', async () => {
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
      if (!resume) throw new Error('expected resumable run')
      await saveState(resume, { status: 'running', gate: undefined })
      await rm(join(resume.dir, 'plan.json'))
      const io = scriptedGate([])

      const result = await executeRun({
        plan: { slug: 'demo', hops: [] },
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io,
        unattended: true,
        resume
      })
      expect(result.status).toBe('failed')
      expect(io.output.join('\n')).toMatch(/unreadable/i)
      expect(JSON.parse(await readFile(join(resume.dir, 'run.json'), 'utf8'))).toMatchObject({
        status: 'failed'
      })
      expect(await invocations(fixture.fake.logPath)).toHaveLength(1)
    } finally {
      fixture.restore()
    }
  })

  test('a persisted plan with zero hops fails the resumed run instead of completing it', async () => {
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
      if (!resume) throw new Error('expected resumable run')
      await saveState(resume, { status: 'running', gate: undefined })
      await writeFile(join(resume.dir, 'plan.json'), JSON.stringify({ slug: 'demo', hops: [] }))
      const io = scriptedGate([])

      const result = await executeRun({
        plan: { slug: 'demo', hops: [] },
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io,
        unattended: true,
        resume
      })
      expect(result.status).toBe('failed')
      expect(io.output.join('\n')).toMatch(/zero hops/i)
      expect(JSON.parse(await readFile(join(resume.dir, 'run.json'), 'utf8'))).toMatchObject({
        status: 'failed'
      })
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

  test('redirect reopens an interactive hop with the appended user note', async () => {
    const fixture = await setup()
    try {
      await setFakeAgentScript(fixture.fake.scriptPath, { artifacts: { 'spec.md': '# Plan\n' } })
      const io = scriptedGate(['r', 'a'], ['Use the smaller API'])
      const result = await executeRun({
        plan: makePlan([makeHop(0, { interaction: 'interactive' })]),
        repoRoot: fixture.repoRoot,
        paths: fixture.paths,
        io,
        unattended: false
      })
      expect(result.status).toBe('completed')
      const calls = await invocations(fixture.fake.logPath)
      expect(calls).toHaveLength(2)
      expect(calls.every(({ interactive }) => interactive)).toBe(true)
      expect(calls[1]?.args.join('\n')).toContain('## User redirect note\nUse the smaller API')
      expect(io.output.join('\n')).toContain('Re-running hop 1 with your note…')
    } finally {
      fixture.restore()
    }
  })
})
