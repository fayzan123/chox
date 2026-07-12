import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
  return result.stdout.trim()
}

export async function initGitRepo(root: string): Promise<string> {
  const repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await git(repo, 'init')
  await git(repo, 'config', 'user.email', 'chox-tests@example.invalid')
  await git(repo, 'config', 'user.name', 'Chox Tests')
  await writeFile(join(repo, 'README.md'), '# fixture\n')
  await git(repo, 'add', 'README.md')
  await git(repo, 'commit', '-m', 'initial')
  return repo
}

