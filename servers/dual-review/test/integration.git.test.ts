import { describe, it, expect } from 'vitest'
import { computeDiff } from '../src/git.js'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('computeDiff', () => {
  it('returns non-empty diff after staging a change', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dual-review-git-'))
    execSync('git init -q', { cwd })
    writeFileSync(join(cwd, 'a.txt'), 'hello\n', 'utf8')
    execSync('git add a.txt', { cwd })
    execSync('git -c user.email=test@example.com -c user.name=test commit -m init -q', { cwd })
    writeFileSync(join(cwd, 'a.txt'), 'hello world\n', 'utf8')
    execSync('git add a.txt', { cwd })

    const diff = computeDiff({ cwd, staged: true, maxBuffer: 1024 * 1024 })
    expect(diff.length).toBeGreaterThan(0)
  })
})


