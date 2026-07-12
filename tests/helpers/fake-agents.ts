import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

export interface FakeAgentScript {
  stdout?: Array<string | Record<string, unknown>>
  artifacts?: Record<string, string>
  copyArtifacts?: Record<string, string>
  requireArtifacts?: string[]
  exitCode?: number
}

export interface FakeAgentInstructions extends FakeAgentScript {
  calls?: FakeAgentScript[]
}

export async function installFakeAgents(root: string): Promise<{
  bin: string
  env: NodeJS.ProcessEnv
  scriptPath: string
  stdinPath: string
  argvPath: string
  logPath: string
}> {
  const bin = join(root, 'bin')
  const driver = join(root, 'fake-agent.mjs')
  const scriptPath = join(root, 'instructions.json')
  const stdinPath = join(root, 'stdin.txt')
  const argvPath = join(root, 'argv.json')
  const logPath = join(root, 'invocations.jsonl')
  const counterPath = join(root, 'counter.txt')
  await mkdir(bin, { recursive: true })
  await writeFile(driver, [
    "import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'",
    "import { dirname, join } from 'node:path'",
    '',
    "const [binary, ...args] = process.argv.slice(2)",
    "let stdin = ''",
    "for await (const chunk of process.stdin) stdin += chunk",
    "if (args.includes('--version')) { process.stdout.write(binary + '-fake 1.0.0\\n'); process.exit(Number(process.env.FAKE_VERSION_EXIT ?? 0)) }",
    "await writeFile(process.env.FAKE_STDIN_PATH, stdin)",
    "await writeFile(process.env.FAKE_ARGV_PATH, JSON.stringify({ binary, args }))",
    "await appendFile(process.env.FAKE_LOG_PATH, JSON.stringify({ binary, args, stdin }) + '\\n')",
    "let call = 0",
    "try { call = Number(await readFile(process.env.FAKE_COUNTER_PATH, 'utf8')) } catch {}",
    "await writeFile(process.env.FAKE_COUNTER_PATH, String(call + 1))",
    "const instructions = JSON.parse(await readFile(process.env.FAKE_SCRIPT_PATH, 'utf8'))",
    "const script = instructions.calls?.[call] ?? instructions.calls?.at(-1) ?? instructions",
    "for (const name of script.requireArtifacts ?? []) {",
    "  try { await readFile(join(process.cwd(), '.chox-run', name)) } catch { process.stderr.write('missing required artifact: ' + name + '\\n'); process.exit(97) }",
    '}',
    "for (const [name, contents] of Object.entries(script.artifacts ?? {})) {",
    "  const path = join(process.cwd(), '.chox-run', name)",
    "  await mkdir(dirname(path), { recursive: true })",
    "  await writeFile(path, String(contents))",
    '}',
    "for (const [name, source] of Object.entries(script.copyArtifacts ?? {})) {",
    "  const contents = await readFile(join(process.cwd(), '.chox-run', String(source)), 'utf8')",
    "  const path = join(process.cwd(), '.chox-run', name)",
    "  await mkdir(dirname(path), { recursive: true })",
    "  await writeFile(path, contents)",
    '}',
    "for (const line of script.stdout ?? []) process.stdout.write((typeof line === 'string' ? line : JSON.stringify(line)) + '\\n')",
    'process.exitCode = Number(script.exitCode ?? 0)',
    ''
  ].join('\n'))

  for (const binary of ['claude', 'codex']) {
    const sh = join(bin, binary)
    await writeFile(sh, `#!/bin/sh\nexec "${process.execPath}" "${driver}" "${binary}" "$@"\n`)
    await chmod(sh, 0o755)
    await writeFile(join(bin, `${binary}.cmd`), `@"${process.execPath}" "${driver}" "${binary}" %*\r\n`)
  }
  await writeFile(scriptPath, JSON.stringify({ stdout: [] }))
  return {
    bin,
    scriptPath,
    stdinPath,
    argvPath,
    logPath,
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_SCRIPT_PATH: scriptPath,
      FAKE_STDIN_PATH: stdinPath,
      FAKE_ARGV_PATH: argvPath,
      FAKE_LOG_PATH: logPath,
      FAKE_COUNTER_PATH: counterPath
    }
  }
}

export async function setFakeAgentScript(path: string, script: FakeAgentInstructions): Promise<void> {
  await writeFile(path, JSON.stringify(script))
}
