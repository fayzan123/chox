import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

export interface FakeAgentScript {
  stdout?: Array<string | Record<string, unknown>>
  artifacts?: Record<string, string>
  exitCode?: number
}

export async function installFakeAgents(root: string): Promise<{
  bin: string
  env: NodeJS.ProcessEnv
  scriptPath: string
  stdinPath: string
  argvPath: string
}> {
  const bin = join(root, 'bin')
  const driver = join(root, 'fake-agent.mjs')
  const scriptPath = join(root, 'instructions.json')
  const stdinPath = join(root, 'stdin.txt')
  const argvPath = join(root, 'argv.json')
  await mkdir(bin, { recursive: true })
  await writeFile(driver, [
    "import { mkdir, readFile, writeFile } from 'node:fs/promises'",
    "import { dirname, join } from 'node:path'",
    '',
    "const [binary, ...args] = process.argv.slice(2)",
    "let stdin = ''",
    "for await (const chunk of process.stdin) stdin += chunk",
    "await writeFile(process.env.FAKE_STDIN_PATH, stdin)",
    "await writeFile(process.env.FAKE_ARGV_PATH, JSON.stringify({ binary, args }))",
    "const script = JSON.parse(await readFile(process.env.FAKE_SCRIPT_PATH, 'utf8'))",
    "for (const [name, contents] of Object.entries(script.artifacts ?? {})) {",
    "  const path = join(process.cwd(), '.chox-run', name)",
    "  await mkdir(dirname(path), { recursive: true })",
    "  await writeFile(path, String(contents))",
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
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_SCRIPT_PATH: scriptPath,
      FAKE_STDIN_PATH: stdinPath,
      FAKE_ARGV_PATH: argvPath
    }
  }
}

export async function setFakeAgentScript(path: string, script: FakeAgentScript): Promise<void> {
  await writeFile(path, JSON.stringify(script))
}

