import { createHmac, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from 'node:path'
import { fileURLToPath } from 'node:url'

const maxIntentTokens = 24
const maxFixtureStringLength = 384

const stopwords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'may', 'my', 'not', 'of',
  'on', 'or', 'our', 'please', 'should', 'so', 'that', 'the', 'their',
  'then', 'there', 'these', 'this', 'to', 'up', 'us', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'will', 'with', 'would', 'you', 'your'
])

const safeValueKeys = new Set([
  'type',
  'subtype',
  'role',
  'originator',
  'source',
  'thread_source',
  'model_provider',
  'permissionMode',
  'userType',
  'cli_version',
  'version'
])

// Only vendor schema keys are retained verbatim. Tool payloads can contain
// user-controlled object keys (paths, env names, or prompt fragments), so an
// identifier-shaped key is not safe merely because it looks conventional.
const schemaKeys = new Set([
  'base_instructions',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
  'cached_input_tokens',
  'cli_version',
  'command',
  'content',
  'cwd',
  'duration_ms',
  'event_type',
  'git',
  'gitBranch',
  'id',
  'input',
  'input_tokens',
  'isSidechain',
  'message',
  'model',
  'model_context_window',
  'model_provider',
  'name',
  'originator',
  'output_tokens',
  'parentUuid',
  'payload',
  'permissionMode',
  'repo_root',
  'repository_url',
  'role',
  'sessionId',
  'session_id',
  'source',
  'subtype',
  'text',
  'thread_source',
  'timestamp',
  'total_tokens',
  'turn_id',
  'type',
  'userType',
  'usage',
  'uuid',
  'version'
])

const pathKeyPattern = /(?:^|_)(?:cwd|path|repo|repo_root|repository|root|worktree)(?:$|_)/i
const idKeyPattern = /(?:^|_)(?:id|uuid)(?:$|_)/i
const textKeyPattern = /(?:content|text|prompt|instruction|command|description|summary|title|message)/i

export interface FixtureSourceSummary {
  discoveredFiles: number
  writtenFiles: number
  retainedLines: number
  invalidLines: number
}

export interface FixtureRedactionSummary {
  claudeCode: FixtureSourceSummary
  codex: FixtureSourceSummary
}

export interface RedactFixturesOptions {
  claudeHome: string
  codexHome: string
  outputRoot: string
  homeDir: string
  fingerprintKey?: Uint8Array
}

export interface VerifyFixturesOptions {
  outputRoot: string
  homeDir: string
  forbiddenText?: string[]
}

interface RedactionContext {
  fingerprintKey: Uint8Array
  pathMap: Map<string, string>
  idMap: Map<string, string>
  dynamicKeyMap: Map<string, string>
  sensitiveFragments: string[]
}

interface SanitizeState {
  role: 'user' | 'assistant' | undefined
  intent: string | undefined
  intentCanonicalOnly: boolean
  intentWritten: boolean
}

interface RetainedLine {
  index: number
  value: unknown
}

export class FixtureRedactionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FixtureRedactionError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/')
}

function dashEncode(value: string): string {
  return normalizedPath(value).replace(/[/.]/g, '-')
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function assertSafeOutput(inputs: string[], outputRoot: string): void {
  const output = resolve(outputRoot)
  if (dirname(output) === output) {
    throw new FixtureRedactionError('Fixture output cannot be a filesystem root')
  }
  for (const input of inputs.map((value) => resolve(value))) {
    if (isWithin(input, output) || isWithin(output, input)) {
      throw new FixtureRedactionError(
        `Fixture output must not overlap an input tree: ${output}`
      )
    }
  }
}

async function discoverJsonl(root: string): Promise<string[]> {
  try {
    await access(root, constants.R_OK)
  } catch {
    throw new FixtureRedactionError(`Fixture source is missing or unreadable: ${root}`)
  }

  const found: string[] = []
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        found.push(path)
      }
    }
  }
  await visit(root)
  return found
}

function intentTokens(text: string): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```/g, ' ')
  const withoutPaths = withoutCode
    .replace(/(?:[A-Za-z]:[\\/]|\.{0,2}[\\/]|~[\\/]|[\\/])(?:[^\s"'`]+[\\/]?)+/g, ' ')
  const matches = withoutPaths.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? []
  const distinct: string[] = []
  const seen = new Set<string>()
  for (const token of matches) {
    if (token.length < 2 || stopwords.has(token) || seen.has(token)) continue
    seen.add(token)
    distinct.push(token)
    if (distinct.length === maxIntentTokens) break
  }
  return distinct.sort()
}

function intentFingerprint(text: string, key: Uint8Array): string {
  const fingerprints = intentTokens(text).map((token) => {
    const digest = createHmac('sha256', key).update(token).digest('hex').slice(0, 10)
    return `fp${digest}`
  })
  return [
    '<redacted:user-intent>',
    ...fingerprints
  ].join(' ')
}

function recordRole(value: Record<string, unknown>): 'user' | 'assistant' | undefined {
  if (value.type === 'user') return 'user'
  if (value.type === 'assistant') return 'assistant'
  const message = isRecord(value.message) ? value.message : undefined
  const payload = isRecord(value.payload) ? value.payload : undefined
  for (const role of [message?.role, payload?.role, value.role]) {
    if (role === 'user' || role === 'assistant') return role
  }
  return undefined
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings)
  }
  if (!isRecord(value)) return []
  return Object.values(value).flatMap(collectStrings)
}

function canonicalMessageText(value: Record<string, unknown>): string[] {
  const message = isRecord(value.message) ? value.message : undefined
  const payload = isRecord(value.payload) ? value.payload : undefined
  return [message?.content, payload?.content, value.content]
    .flatMap((content) => collectStrings(content))
}

function collectMessageText(value: unknown, withinText = false): string[] {
  if (typeof value === 'string') return withinText ? [value] : []
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMessageText(item, withinText))
  }
  if (!isRecord(value)) return []

  const text: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const nextWithin = withinText || textKeyPattern.test(key)
    text.push(...collectMessageText(child, nextWithin))
  }
  return text
}

function mapPath(value: string, context: RedactionContext): string {
  const normalized = normalizedPath(value)
  let mapped = context.pathMap.get(normalized)
  if (!mapped) {
    mapped = `/workspace/path-${String(context.pathMap.size + 1).padStart(3, '0')}`
    context.pathMap.set(normalized, mapped)
  }
  return mapped
}

function mapId(value: string, context: RedactionContext): string {
  let mapped = context.idMap.get(value)
  if (!mapped) {
    mapped = `id-${String(context.idMap.size + 1).padStart(3, '0')}`
    context.idMap.set(value, mapped)
  }
  return mapped
}

function sanitizedKey(key: string, context: RedactionContext): string {
  const lowered = key.toLocaleLowerCase('en-US')
  if (
    schemaKeys.has(key)
    && !context.sensitiveFragments.some((fragment) => lowered.includes(fragment))
  ) return key
  let mapped = context.dynamicKeyMap.get(key)
  if (!mapped) {
    mapped = `field_${String(context.dynamicKeyMap.size + 1).padStart(3, '0')}`
    context.dynamicKeyMap.set(key, mapped)
  }
  return mapped
}

function isCanonicalMessageContent(path: string[]): boolean {
  const key = path.at(-1)
  if (key === 'content') {
    return path.length === 1 || path.includes('message') || path.includes('payload')
  }
  return key === 'text'
    && path.includes('content')
    && (path.includes('message') || path.includes('payload'))
}

function sensitivePlaceholder(key: string, path: string[], state: SanitizeState): string {
  if (/command/i.test(key)) return '<redacted:command>'
  if (/instruction|system/i.test(key)) return '<redacted:instructions>'
  if (state.role === 'user') {
    const isIntentTarget = isCanonicalMessageContent(path) || !state.intentCanonicalOnly
    if (state.intent !== undefined && !state.intentWritten && isIntentTarget) {
      state.intentWritten = true
      return state.intent
    }
    return '<redacted:user-message>'
  }
  if (state.role === 'assistant') return '<redacted:assistant-message>'
  return '<redacted:text>'
}

function sanitizeString(
  path: string[],
  value: string,
  state: SanitizeState,
  context: RedactionContext
): string {
  const key = path.at(-1) ?? ''
  if (key === 'timestamp' && !Number.isNaN(Date.parse(value))) return value
  if (pathKeyPattern.test(key) || /^(?:[A-Za-z]:[\\/]|[\\/~])/.test(value)) {
    return mapPath(value, context)
  }
  if (idKeyPattern.test(key)) return mapId(value, context)
  if (textKeyPattern.test(key)) return sensitivePlaceholder(key, path, state)
  const lowered = value.toLocaleLowerCase('en-US')
  if (
    safeValueKeys.has(key)
    && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
    && !context.sensitiveFragments.some((fragment) => lowered.includes(fragment))
  ) return value
  if (/url|branch|author|user|email/i.test(key)) return `<redacted:${key.toLowerCase()}>`
  return '<redacted:string>'
}

function sanitizeValue(
  value: unknown,
  path: string[],
  state: SanitizeState,
  context: RedactionContext
): unknown {
  if (typeof value === 'string') return sanitizeString(path, value, state, context)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, path, state, context))
  }
  if (!isRecord(value)) return null

  const output: Record<string, unknown> = {}
  for (const [childKey, child] of Object.entries(value)) {
    output[sanitizedKey(childKey, context)] = sanitizeValue(
      child,
      [...path, childKey],
      state,
      context
    )
  }
  return output
}

function shapeSignature(value: Record<string, unknown>): string {
  const payload = isRecord(value.payload) ? value.payload : undefined
  const message = isRecord(value.message) ? value.message : undefined
  return [
    typeof value.type === 'string' ? value.type : '<missing-type>',
    typeof payload?.type === 'string' ? payload.type : '',
    typeof payload?.role === 'string' ? payload.role : '',
    typeof message?.role === 'string' ? message.role : '',
    recordRole(value) ?? ''
  ].join('|')
}

function sanitizeRecord(
  value: Record<string, unknown>,
  firstIntent: boolean,
  context: RedactionContext
): unknown {
  const role = recordRole(value)
  const canonicalText = firstIntent && role === 'user'
    ? canonicalMessageText(value)
    : []
  const messageText = firstIntent && role === 'user'
    ? (canonicalText.length > 0 ? canonicalText : collectMessageText(value)).join(' ')
    : ''
  const state: SanitizeState = {
    role,
    intent: firstIntent && role === 'user'
      ? intentFingerprint(messageText, context.fingerprintKey)
      : undefined,
    intentCanonicalOnly: canonicalText.length > 0,
    intentWritten: false
  }
  return sanitizeValue(value, [], state, context)
}

async function redactFile(
  input: string,
  output: string,
  context: RedactionContext
): Promise<{ retainedLines: number, invalidLines: number }> {
  const lines = (await readFile(input, 'utf8')).split(/\r?\n/)
  const retained: RetainedLine[] = []
  const retainedIndexes = new Set<number>()
  const signatures = new Set<string>()
  let firstIntentSeen = false
  let invalidLines = 0
  let last: RetainedLine | undefined

  for (const [index, rawLine] of lines.entries()) {
    if (rawLine.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(rawLine) as unknown
    } catch {
      invalidLines += 1
      continue
    }

    if (value === null) {
      if (!signatures.has('<null>')) {
        signatures.add('<null>')
        retained.push({ index, value: null })
        retainedIndexes.add(index)
      }
      continue
    }
    if (!isRecord(value)) {
      invalidLines += 1
      continue
    }

    const role = recordRole(value)
    const firstIntent = role === 'user' && !firstIntentSeen
    if (firstIntent) firstIntentSeen = true
    const sanitized = sanitizeRecord(value, firstIntent, context)
    const line = { index, value: sanitized }
    last = line
    const signature = shapeSignature(value)
    if (!signatures.has(signature) || firstIntent) {
      signatures.add(signature)
      retained.push(line)
      retainedIndexes.add(index)
    }
  }

  if (last && !retainedIndexes.has(last.index)) retained.push(last)
  retained.sort((left, right) => left.index - right.index)
  await writeFile(output, `${retained.map(({ value }) => JSON.stringify(value)).join('\n')}\n`, {
    mode: 0o600
  })
  return { retainedLines: retained.length, invalidLines }
}

async function redactSource(
  files: string[],
  outputRoot: string,
  context: RedactionContext
): Promise<FixtureSourceSummary> {
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true, mode: 0o700 })

  let retainedLines = 0
  let invalidLines = 0
  for (const [index, input] of files.entries()) {
    const output = resolve(outputRoot, `session-${String(index + 1).padStart(3, '0')}.jsonl`)
    const result = await redactFile(input, output, context)
    retainedLines += result.retainedLines
    invalidLines += result.invalidLines
  }
  return {
    discoveredFiles: files.length,
    writtenFiles: files.length,
    retainedLines,
    invalidLines
  }
}

function collectFixtureStrings(value: unknown, found: string[]): void {
  if (typeof value === 'string') {
    found.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectFixtureStrings(item, found)
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      found.push(key)
      collectFixtureStrings(child, found)
    }
  }
}

export async function verifyRedactedFixtures(opts: VerifyFixturesOptions): Promise<void> {
  const homeVariants = new Set([
    opts.homeDir,
    normalizedPath(opts.homeDir),
    dashEncode(opts.homeDir)
  ].filter(Boolean).map((value) => value.toLocaleLowerCase('en-US')))
  const username = basename(normalizedPath(opts.homeDir)).toLocaleLowerCase('en-US')
  const forbidden = [
    ...homeVariants,
    ...(opts.forbiddenText ?? []).map((value) => value.toLocaleLowerCase('en-US'))
  ].filter(Boolean)
  const violations: string[] = []

  for (const source of ['claude-code', 'codex']) {
    const root = resolve(opts.outputRoot, source)
    const files = await discoverJsonl(root)
    for (const file of files) {
      const relativeFile = relative(opts.outputRoot, file)
      const raw = await readFile(file, 'utf8')
      const loweredRaw = raw.toLocaleLowerCase('en-US')
      for (const secret of forbidden) {
        if (loweredRaw.includes(secret)) {
          violations.push(`${relativeFile}: contains forbidden redaction input`)
          break
        }
      }
      if (username && loweredRaw.includes(username)) {
        violations.push(`${relativeFile}: contains the source username`)
      }

      for (const [index, line] of raw.split(/\r?\n/).entries()) {
        if (line.trim() === '') continue
        let value: unknown
        try {
          value = JSON.parse(line) as unknown
        } catch {
          violations.push(`${relativeFile}:${index + 1}: malformed JSONL`)
          continue
        }
        if (value !== null && !isRecord(value)) {
          violations.push(`${relativeFile}:${index + 1}: expected an object or null`)
        }
        const strings: string[] = []
        collectFixtureStrings(value, strings)
        for (const string of strings) {
          if (string.length > maxFixtureStringLength) {
            violations.push(
              `${relativeFile}:${index + 1}: string exceeds ${maxFixtureStringLength} characters`
            )
            break
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new FixtureRedactionError(
      `Redacted fixture verification failed:\n${violations.map((item) => `- ${item}`).join('\n')}`
    )
  }
}

export async function redactFixtures(
  opts: RedactFixturesOptions
): Promise<FixtureRedactionSummary> {
  if (opts.homeDir.trim() === '') {
    throw new FixtureRedactionError('homeDir must be non-empty')
  }
  const claudeRoot = resolve(opts.claudeHome, 'projects')
  const codexRoot = resolve(opts.codexHome, 'sessions')
  assertSafeOutput([claudeRoot, codexRoot], opts.outputRoot)
  const [claudeFiles, codexFiles] = await Promise.all([
    discoverJsonl(claudeRoot),
    discoverJsonl(codexRoot)
  ])
  const sensitiveFragments = new Set([
    opts.homeDir,
    normalizedPath(opts.homeDir),
    dashEncode(opts.homeDir),
    basename(normalizedPath(opts.homeDir))
  ].filter(Boolean).map((value) => value.toLocaleLowerCase('en-US')))
  const context: RedactionContext = {
    fingerprintKey: opts.fingerprintKey ?? randomBytes(32),
    pathMap: new Map(),
    idMap: new Map(),
    dynamicKeyMap: new Map(),
    sensitiveFragments: [...sensitiveFragments]
  }

  const claudeCode = await redactSource(
    claudeFiles,
    resolve(opts.outputRoot, 'claude-code'),
    context
  )
  const codex = await redactSource(
    codexFiles,
    resolve(opts.outputRoot, 'codex'),
    context
  )
  await verifyRedactedFixtures({ outputRoot: opts.outputRoot, homeDir: opts.homeDir })
  return { claudeCode, codex }
}

async function main(args: string[]): Promise<void> {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--verify')) {
    throw new FixtureRedactionError('Usage: npm run fixtures:redact | npm run fixtures:verify')
  }
  const outputRoot = dirname(fileURLToPath(import.meta.url))
  const homeDir = homedir()
  if (args[0] === '--verify') {
    await verifyRedactedFixtures({ outputRoot, homeDir })
    process.stdout.write('Redacted fixtures passed privacy verification.\n')
    return
  }

  const summary = await redactFixtures({
    claudeHome: resolve(homeDir, '.claude'),
    codexHome: resolve(homeDir, '.codex'),
    outputRoot,
    homeDir
  })
  process.stdout.write([
    `Redacted ${summary.claudeCode.writtenFiles} Claude Code session file(s).`,
    `Redacted ${summary.codex.writtenFiles} Codex session file(s).`,
    'Privacy verification passed. Review the diff before committing.',
    ''
  ].join('\n'))
}

const invokedPath = process.argv[1]
if (invokedPath && resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`fixture redactor: ${message}\n`)
    process.exitCode = 1
  })
}
