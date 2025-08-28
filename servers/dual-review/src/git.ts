import { execSync } from 'node:child_process'

export interface ComputeDiffOptions {
  cwd: string
  staged: boolean
  maxBuffer: number
}

/**
 * Compute the git diff in a robust way across environments.
 * Tries --cached, then --staged, then plain diff.
 */
export function computeDiff(options: ComputeDiffOptions): string {
  const { cwd, staged, maxBuffer } = options

  const tryExec = (cmd: string): string | null => {
    try {
      return execSync(cmd, { cwd, encoding: 'utf8', maxBuffer })
    } catch {
      return null
    }
  }

  if (staged) {
    const cached = tryExec('git diff --cached')
    if (cached !== null) return cached

    const stagedOut = tryExec('git diff --staged')
    if (stagedOut !== null) return stagedOut
  }

  const plain = tryExec('git diff')
  return plain ?? ''
}


