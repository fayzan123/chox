import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  delimiter,
  dirname,
  join,
  relative,
  resolve
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function command(binary, args, opts = {}) {
  return execFileSync(binary, args, {
    cwd: opts.cwd ?? packageRoot,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function outsidePackagePath(path) {
  const rel = relative(packageRoot, resolve(path))
  return rel !== '' && (rel.startsWith('..') || resolve(rel) === rel)
}

async function treeHash(root) {
  const hash = createHash('sha256')
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(dir, entry.name)
      const rel = relative(root, path).replaceAll('\\', '/')
      hash.update(rel)
      if (entry.isDirectory()) await visit(path)
      else hash.update(await readFile(path))
    }
  }
  await visit(root)
  return hash.digest('hex')
}

async function treeFiles(root) {
  const files = []
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await visit(path)
      else files.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  await visit(root)
  return files
}

async function assertBuildOutputMatchesSources() {
  const sourceFiles = [
    ...(await treeFiles(join(packageRoot, 'bin'))).map((path) => `bin/${path}`),
    ...(await treeFiles(join(packageRoot, 'src'))).map((path) => `src/${path}`)
  ].filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'))
  const expected = new Set(sourceFiles.flatMap((path) => {
    const output = path.slice(0, -3)
    return [`${output}.js`, `${output}.js.map`]
  }))
  const actual = new Set(await treeFiles(join(packageRoot, 'dist')))
  const missing = [...expected].filter((path) => !actual.has(path))
  const unexpected = [...actual].filter((path) => !expected.has(path))
  assert(
    missing.length === 0 && unexpected.length === 0,
    `dist does not exactly match TypeScript sources; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}`
  )
}

async function installFakeAgents(root) {
  const bin = join(root, 'fake-bin')
  const driver = join(root, 'fake-agent.mjs')
  await mkdir(bin, { recursive: true })
  await writeFile(driver, [
    "import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'",
    "import { join } from 'node:path'",
    '',
    "const [binary, ...args] = process.argv.slice(2)",
    "if (args.includes('--version')) { process.stdout.write(binary + '-pack-fake 1.0.0\\n'); process.exit(0) }",
    "const interactive = binary === 'claude' ? !args.includes('-p') : !args.includes('exec')",
    "let prompt = interactive ? String(args.at(-1) ?? '') : ''",
    "if (!interactive) for await (const chunk of process.stdin) prompt += chunk",
    "let call = 0",
    "try { call = Number(await readFile(process.env.FAKE_PACK_COUNTER, 'utf8')) } catch {}",
    "if (call === 0 && !prompt.includes(process.env.PACK_TASK_MARKER)) { process.stderr.write('packed task marker missing\\n'); process.exit(91) }",
    "await writeFile(process.env.FAKE_PACK_COUNTER, String(call + 1))",
    "await appendFile(process.env.FAKE_PACK_LOG, JSON.stringify({ binary, args, prompt, cwd: process.cwd(), interactive }) + '\\n')",
    "const artifacts = join(process.cwd(), '.chox-run')",
    "await mkdir(artifacts, { recursive: true })",
    'if (call === 0) {',
    "  await writeFile(join(artifacts, 'spec.md'), '# Packed plan\\n' + process.env.PACK_TASK_MARKER + '\\n')",
    "  await writeFile(join(artifacts, 'manifest.json'), JSON.stringify({ files: { create: ['pack-result.txt'], modify: [], delete: [] }, commands: [] }))",
    "  await writeFile(join(artifacts, 'challenge-notes.md'), 'No deviations.\\n')",
    '} else if (call === 1) {',
    "  await writeFile(join(process.cwd(), 'pack-result.txt'), 'packed run completed\\n')",
    "  await writeFile(join(artifacts, 'implementation.md'), 'Implemented.\\n')",
    "  await writeFile(join(artifacts, 'implementation-notes.md'), 'No deviations.\\n')",
    '} else {',
    "  await writeFile(join(artifacts, 'review.md'), '# Review\\nPass.\\n')",
    '}',
    ''
  ].join('\n'))
  for (const binary of ['claude', 'codex']) {
    const path = join(bin, binary)
    await writeFile(path, `#!/bin/sh\nexec "${process.execPath}" "${driver}" "${binary}" "$@"\n`)
    await chmod(path, 0o755)
  }
  return bin
}

async function initRepo(root) {
  const repo = join(root, 'repo')
  await mkdir(repo)
  command('git', ['init'], { cwd: repo })
  command('git', ['config', 'user.email', 'verify-pack@example.invalid'], { cwd: repo })
  command('git', ['config', 'user.name', 'Chox Pack Verification'], { cwd: repo })
  await writeFile(join(repo, 'README.md'), '# packed fixture\n')
  command('git', ['add', 'README.md'], { cwd: repo })
  command('git', ['commit', '-m', 'initial'], { cwd: repo })
  return repo
}

async function main() {
  if (process.platform === 'win32') {
    throw new Error('verify:pack supports the product platforms: macOS and Linux (WSL counts)')
  }
  const root = await mkdtemp(join(tmpdir(), 'chox-verify-pack-'))
  try {
    const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    assert(
      typeof packageManifest === 'object' && packageManifest !== null && !Array.isArray(packageManifest),
      'package.json must contain an object'
    )
    const packageName = packageManifest.name
    assert(
      typeof packageName === 'string' && packageName.length > 0,
      'package.json must contain a package name'
    )
    const packageSegments = packageName.split('/')
    assert(
      packageSegments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
      `package.json contains an invalid package name: ${packageName}`
    )
    const packDir = join(root, 'pack')
    const prefix = join(root, 'prefix')
    const npmEnv = {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_cache: join(root, 'npm-cache'),
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false'
    }
    await mkdir(packDir)
    await mkdir(prefix)

    process.stdout.write('verify:pack · packing artifact\n')
    const packed = JSON.parse(command(npm, [
      'pack', '--json', '--pack-destination', packDir
    ], { env: npmEnv }))
    const filename = packed?.[0]?.filename
    assert(typeof filename === 'string', 'npm pack did not report a tarball filename')
    const tarball = join(packDir, filename)
    await assertBuildOutputMatchesSources()

    process.stdout.write('verify:pack · installing into fresh prefix\n')
    command(npm, ['install', '--global', '--prefix', prefix, tarball], {
      env: npmEnv
    })
    const globalRoot = command(npm, ['root', '--global', '--prefix', prefix], { env: npmEnv }).trim()
    const installedPackage = join(globalRoot, ...packageSegments)
    const installedBin = join(prefix, 'bin', 'chox')
    const installedManifest = JSON.parse(
      await readFile(join(installedPackage, 'package.json'), 'utf8')
    )
    assert(
      installedManifest?.name === packageName,
      `packed install resolved ${String(installedManifest?.name)}, expected ${packageName}`
    )
    const builtInDir = join(installedPackage, 'relays', 'spec-implement-review')
    const builtInBefore = await treeHash(builtInDir)

    const userHome = join(root, 'user-home')
    const choxHome = join(root, 'chox-home')
    const fakeBin = await installFakeAgents(root)
    await mkdir(join(userHome, '.claude', 'projects'), { recursive: true })
    await mkdir(join(userHome, '.codex', 'sessions'), { recursive: true })
    const safeSystemPath = (process.env.PATH ?? '')
      .split(delimiter)
      .filter((entry) => entry !== '' && outsidePackagePath(entry))
    const task = 'PACKED_TASK_1C {{repo}} "json-hostile" café\nsecond line'
    const env = {
      ...process.env,
      PATH: [fakeBin, join(prefix, 'bin'), ...safeSystemPath].join(delimiter),
      HOME: userHome,
      USERPROFILE: userHome,
      CODEX_HOME: join(userHome, '.codex'),
      CLAUDE_CONFIG_DIR: join(userHome, '.claude'),
      CHOX_HOME: choxHome,
      FAKE_PACK_COUNTER: join(root, 'fake-counter.txt'),
      FAKE_PACK_LOG: join(root, 'fake-invocations.jsonl'),
      PACK_TASK_MARKER: task
    }
    assert(!env.PATH.split(delimiter).some((entry) => !outsidePackagePath(entry) && entry !== fakeBin), 'source checkout leaked onto packed journey PATH')

    const repo = await initRepo(root)
    const taskFile = join(repo, 'task.md')
    await writeFile(taskFile, task)
    const cli = (args) => command(installedBin, args, { cwd: repo, env })

    process.stdout.write('verify:pack · doctor, relay discovery, and dry run\n')
    cli(['doctor'])
    const listed = cli(['relay', 'list'])
    assert(listed.includes('spec-implement-review'), 'packed relay list omitted the built-in starter')
    const shown = cli(['relay', 'show', 'spec-implement-review'])
    assert(shown.includes('built-in'), 'packed relay show omitted built-in provenance')
    const dryRun = cli(['run', 'spec-implement-review', '--task-file', taskFile, '--dry-run'])
    assert(dryRun.includes(task), 'packed dry run did not preserve the exact task text')
    assert(dryRun.includes('{{repo}}'), 'task text was expanded in a second replacement pass')

    process.stdout.write('verify:pack · gate interruption and persisted resume\n')
    const priorCwd = process.cwd()
    const priorEnv = { ...process.env }
    try {
      process.chdir(repo)
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, env)
      const cliModule = await import(pathToFileURL(join(installedPackage, 'dist', 'bin', 'chox.js')).href)
      const gatesModule = await import(pathToFileURL(join(installedPackage, 'dist', 'src', 'harness', 'gates.js')).href)
      const output = []
      const errors = []
      let interrupt = true
      const gateIO = {
        print(text) { output.push(String(text)) },
        async readKey() {
          if (interrupt) {
            interrupt = false
            throw new gatesModule.RunInterruptedError()
          }
          return 'a'
        },
        async openEditor() {},
        async readLine() { return '' },
        release() {}
      }
      const ctx = {
        cwd: repo,
        env: process.env,
        stdinIsTTY: true,
        stdout(text) { output.push(text) },
        stderr(text) { errors.push(text) },
        gateIO
      }
      const interrupted = await cliModule.runCli([
        'run', 'spec-implement-review', '--task-file', taskFile
      ], ctx)
      assert(interrupted === 130, `packed run interruption exited ${interrupted}, expected 130`)
      await writeFile(taskFile, 'TASK FILE CHANGED AFTER INTERRUPTION')
      const resumed = await cliModule.runCli([
        'run', 'spec-implement-review', '--resume'
      ], ctx)
      assert(resumed === 0, `packed resume exited ${resumed}, expected 0`)
      assert(errors.join('').includes('Run interrupted'), 'packed run did not report the interrupted gate')
    } finally {
      process.chdir(priorCwd)
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, priorEnv)
    }

    const runRoot = join(choxHome, 'runs', 'spec-implement-review')
    const [runId] = await readdir(runRoot)
    assert(typeof runId === 'string', 'packed journey did not persist a run')
    const plan = JSON.parse(await readFile(join(runRoot, runId, 'plan.json'), 'utf8'))
    const persistedPrompts = plan.hops.map((hop) => String(hop.prompt)).join('\n')
    assert(persistedPrompts.includes(task), 'persisted packed plan lost the original task')
    assert(!persistedPrompts.includes('TASK FILE CHANGED AFTER INTERRUPTION'), 'resume reread the task file')
    const invocations = (await readFile(env.FAKE_PACK_LOG, 'utf8'))
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    assert(invocations.length === 3, `packed journey spawned ${invocations.length} agents, expected 3`)
    assert(invocations[0].prompt.includes(task), 'the first packed agent session did not receive the task')

    process.stdout.write('verify:pack · doctor bundle privacy and built-in immutability\n')
    cli(['doctor', '--bundle'])
    const bundle = await readFile(join(repo, 'chox-doctor-bundle.json'), 'utf8')
    assert(!bundle.includes('PACKED_TASK_1C'), 'doctor bundle leaked task text')
    assert(!bundle.includes('Turn the task below into an implementation-ready plan'), 'doctor bundle leaked compiled prompt text')
    assert(await treeHash(builtInDir) === builtInBefore, 'the packed journey modified the built-in relay')

    process.stdout.write('verify:pack · passed\n')
  } finally {
    if (process.env.CHOX_KEEP_PACK_TMP !== '1') {
      await rm(root, { recursive: true, force: true })
    } else {
      process.stdout.write(`verify:pack · kept ${root}\n`)
    }
  }
}

await main()
