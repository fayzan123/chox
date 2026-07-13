import { access } from 'node:fs/promises'

import { runGit } from '../../system/command.js'

const correlationWindowMs = 15 * 60 * 1000

export async function correlatedSessionEnds(
  repoRoot: string,
  endedAt: string[]
): Promise<Set<string>> {
  const correlated = new Set<string>()
  if (endedAt.length === 0) return correlated
  try {
    await access(repoRoot)
  } catch {
    return correlated
  }

  const times = endedAt.map((value) => Date.parse(value)).filter(Number.isFinite)
  if (times.length === 0) return correlated
  const since = new Date(Math.min(...times) - correlationWindowMs).toISOString()
  const until = new Date(Math.max(...times) + correlationWindowMs).toISOString()
  const result = await runGit(repoRoot, [
    'log', '--all', '--format=%aI', `--since=${since}`, `--until=${until}`
  ], { allowFailure: true })
  if (result.code !== 0) return correlated
  const commits = result.stdout.split(/\r?\n/)
    .map((line) => Date.parse(line.trim()))
    .filter(Number.isFinite)
  for (const value of endedAt) {
    const sessionEnd = Date.parse(value)
    if (commits.some((commit) => Math.abs(commit - sessionEnd) <= correlationWindowMs)) {
      correlated.add(value)
    }
  }
  return correlated
}
