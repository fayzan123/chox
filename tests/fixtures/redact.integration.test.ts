import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import {
  FixtureRedactionError,
  redactFixtures,
  verifyRedactedFixtures
} from '../../fixtures/redact.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

const sourceHome = '/Users/founder.example'
const encodedHome = '-Users-founder-example'
const openingSecret = 'PLAN_PRIVATE_SATELLITE feature alpha beta shared workflow'

function jsonl(values: unknown[]): string {
  return `${values.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join('\n')}\n`
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [key, ...collectStrings(child)])
  }
  return []
}

async function writeSyntheticHomes(root: string): Promise<{
  claudeHome: string
  codexHome: string
  outputRoot: string
}> {
  const claudeHome = join(root, 'raw-claude')
  const codexHome = join(root, 'raw-codex')
  const outputRoot = join(root, 'redacted-output')
  const claudeProject = join(claudeHome, 'projects', `${encodedHome}-Documents-GitHub-shared-repo`)
  const codexSessions = join(codexHome, 'sessions', '2026', '07', '13')
  await mkdir(claudeProject, { recursive: true })
  await mkdir(codexSessions, { recursive: true })

  await writeFile(join(claudeProject, 'raw-claude.jsonl'), jsonl([
    null,
    {
      type: 'user',
      uuid: 'claude-user-uuid',
      sessionId: 'claude-session-id',
      cwd: `${sourceHome}/Documents/GitHub/shared-repo`,
      timestamp: '2026-07-13T14:00:00.000Z',
      prompt: openingSecret,
      message: {
        role: 'user',
        content: `${openingSecret} ${sourceHome}/Documents/GitHub/shared-repo/secret.ts\n\`\`\`ts\nconst privateCode = true\n\`\`\``
      }
    },
    {
      type: 'assistant',
      uuid: 'claude-assistant-uuid',
      timestamp: '2026-07-13T14:20:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'ASSISTANT_PRIVATE_EXPLANATION'.repeat(20) }]
      }
    },
    {
      type: 'file-history-snapshot',
      timestamp: '2026-07-13T14:21:00.000Z',
      snapshot: `${sourceHome}/Documents/GitHub/shared-repo/secret.ts`,
      PRIVATE_DYNAMIC_KEY: 'PRIVATE_DYNAMIC_VALUE'
    },
    '{"type":'
  ]))

  await writeFile(join(codexSessions, 'rollout-test.jsonl'), jsonl([
    {
      timestamp: '2026-07-13T14:30:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'codex-session-id',
        cwd: `${sourceHome}/Documents/GitHub/shared-repo`,
        originator: 'codex_vscode',
        source: 'vscode',
        cli_version: '0.144.1',
        base_instructions: { text: 'CODEX_PRIVATE_SYSTEM_INSTRUCTIONS'.repeat(20) },
        git: { repository_url: `https://example.invalid/${basenameForTest(sourceHome)}/private.git` }
      }
    },
    {
      timestamp: '2026-07-13T14:31:00.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Implement feature alpha beta shared workflow now' }]
      }
    },
    {
      timestamp: '2026-07-13T14:55:00.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete', message: 'CODEX_PRIVATE_RESULT' }
    }
  ]))

  return { claudeHome, codexHome, outputRoot }
}

function basenameForTest(path: string): string {
  return path.split('/').at(-1) ?? ''
}

test('redacts synthetic real-shaped homes while preserving parser and similarity shape', async () => {
  const root = await makeTempDir('chox-redactor-')
  const paths = await writeSyntheticHomes(root)
  const summary = await redactFixtures({
    ...paths,
    homeDir: sourceHome,
    fingerprintKey: new Uint8Array(32).fill(7)
  })

  expect(summary).toMatchObject({
    claudeCode: { discoveredFiles: 1, writtenFiles: 1, invalidLines: 1 },
    codex: { discoveredFiles: 1, writtenFiles: 1, invalidLines: 0 }
  })
  const claudeFiles = await readdir(join(paths.outputRoot, 'claude-code'))
  const codexFiles = await readdir(join(paths.outputRoot, 'codex'))
  expect(claudeFiles).toEqual(['session-001.jsonl'])
  expect(codexFiles).toEqual(['session-001.jsonl'])

  const claude = await readFile(join(paths.outputRoot, 'claude-code', claudeFiles[0] as string), 'utf8')
  const codex = await readFile(join(paths.outputRoot, 'codex', codexFiles[0] as string), 'utf8')
  const combined = `${claude}\n${codex}`
  for (const secret of [
    sourceHome,
    encodedHome,
    'founder.example',
    openingSecret,
    'ASSISTANT_PRIVATE_EXPLANATION',
    'CODEX_PRIVATE_SYSTEM_INSTRUCTIONS',
    'CODEX_PRIVATE_RESULT',
    'privateCode',
    'PRIVATE_DYNAMIC_KEY',
    'PRIVATE_DYNAMIC_VALUE'
  ]) {
    expect(combined).not.toContain(secret)
  }
  expect(claude.split('\n')[0]).toBe('null')
  expect(codex).toContain('"originator":"codex_vscode"')
  const claudePaths = new Set(claude.match(/\/workspace\/path-\d{3}/g) ?? [])
  const codexPaths = new Set(codex.match(/\/workspace\/path-\d{3}/g) ?? [])
  expect([...claudePaths].filter((path) => codexPaths.has(path))).toContain('/workspace/path-001')

  const claudeValues = claude.trim().split('\n').map((line) => JSON.parse(line) as unknown)
  const codexValues = codex.trim().split('\n').map((line) => JSON.parse(line) as unknown)
  const claudeUserMessage = JSON.stringify(
    claudeValues.find((value) => (
      typeof value === 'object'
      && value !== null
      && 'type' in value
      && value.type === 'user'
    ))
  )
  const codexUserMessage = JSON.stringify(
    codexValues.find((value) => (
      typeof value === 'object'
      && value !== null
      && 'payload' in value
      && typeof value.payload === 'object'
      && value.payload !== null
      && 'role' in value.payload
      && value.payload.role === 'user'
    ))
  )
  expect(claudeUserMessage).toMatch(/"message":.*<redacted:user-intent> fp/)
  expect(codexUserMessage).toMatch(/"payload":.*<redacted:user-intent> fp/)
  const claudeFingerprints = new Set(
    collectStrings(claudeValues).flatMap((value) => value.match(/fp[a-f0-9]{10}/g) ?? [])
  )
  const codexFingerprints = new Set(
    collectStrings(codexValues).flatMap((value) => value.match(/fp[a-f0-9]{10}/g) ?? [])
  )
  expect(claudeFingerprints.size).toBeGreaterThan(0)
  expect(codexFingerprints.size).toBeGreaterThan(0)
  expect([...claudeFingerprints].filter((token) => codexFingerprints.has(token)).length).toBeGreaterThan(2)

  await expect(verifyRedactedFixtures({
    outputRoot: paths.outputRoot,
    homeDir: sourceHome,
    forbiddenText: [openingSecret]
  })).resolves.toBeUndefined()
})

test('the verifier rejects raw, encoded, username, malformed, and overlong fixture leaks', async () => {
  const root = await makeTempDir('chox-redactor-invalid-')
  const outputRoot = join(root, 'fixtures')
  await mkdir(join(outputRoot, 'claude-code'), { recursive: true })
  await mkdir(join(outputRoot, 'codex'), { recursive: true })
  await writeFile(join(outputRoot, 'claude-code', 'session-001.jsonl'), [
    JSON.stringify({ type: 'user', cwd: sourceHome, content: 'x'.repeat(385) }),
    '{broken',
    ''
  ].join('\n'))
  await writeFile(join(outputRoot, 'codex', 'session-001.jsonl'), JSON.stringify({
    type: 'session_meta',
    encoded: `${encodedHome}-Documents`,
    username: 'founder.example'
  }))

  await expect(verifyRedactedFixtures({ outputRoot, homeDir: sourceHome }))
    .rejects.toThrow(FixtureRedactionError)
  await expect(verifyRedactedFixtures({ outputRoot, homeDir: sourceHome }))
    .rejects.toThrow(/forbidden|username|malformed|exceeds/i)
})

test('refuses output that overlaps either raw input tree', async () => {
  const root = await makeTempDir('chox-redactor-overlap-')
  const paths = await writeSyntheticHomes(root)
  await expect(redactFixtures({
    ...paths,
    outputRoot: join(paths.claudeHome, 'projects', 'generated'),
    homeDir: sourceHome
  })).rejects.toThrow(/must not overlap/i)
})
