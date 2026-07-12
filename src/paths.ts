import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { ChoxError } from './errors.js'

export interface ChoxPaths {
  home: string
  runs: string
  worktrees: string
  relays: string
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): ChoxPaths {
  const home = resolve(env.CHOX_HOME?.trim() || resolve(homedir(), '.chox'))
  return {
    home,
    runs: resolve(home, 'runs'),
    worktrees: resolve(home, 'worktrees'),
    relays: resolve(home, 'relays')
  }
}

export async function ensureChoxHome(paths: ChoxPaths): Promise<void> {
  try {
    await Promise.all([
      mkdir(paths.runs, { recursive: true }),
      mkdir(paths.worktrees, { recursive: true }),
      mkdir(paths.relays, { recursive: true })
    ])
    await access(paths.home, constants.R_OK | constants.W_OK)
  } catch (error) {
    throw new ChoxError(
      `Chox home is not writable: ${paths.home}. Set CHOX_HOME to a writable directory.`,
      1,
      { cause: error }
    )
  }
}

