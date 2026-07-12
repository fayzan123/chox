import { execFile } from 'node:child_process'

export interface CommandResult {
  stdout: string
  stderr: string
  code: number
}

export function runCommand(
  command: string,
  args: string[],
  opts: { cwd: string, env?: NodeJS.ProcessEnv, allowFailure?: boolean }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      encoding: 'utf8',
      windowsHide: true
    }, (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout),
        stderr: String(stderr),
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0
      }
      if (error && !opts.allowFailure) {
        const detail = result.stderr.trim() || result.stdout.trim() || error.message
        reject(new Error(`${command} ${args.join(' ')} failed: ${detail}`, { cause: error }))
        return
      }
      resolve(result)
    })
  })
}

export function runGit(
  cwd: string,
  args: string[],
  opts: { allowFailure?: boolean } = {}
): Promise<CommandResult> {
  return runCommand('git', args, { cwd, ...opts })
}

