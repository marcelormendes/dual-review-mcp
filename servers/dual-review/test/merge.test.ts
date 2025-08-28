import { describe, it, expect } from 'vitest'
import { mergeAndScore, renderMarkdown, type ReviewPayload } from '../src/merge.js'

const base: ReviewPayload = {
  issues: [],
  summary: { counts: { low: 0, med: 0, high: 0 } },
}

describe('mergeAndScore', () => {
  it('identical single high-security issue yields full overlap and bounded score', () => {
    const issue: ReviewPayload['issues'][number] = {
      category: 'security',
      severity: 'high',
      file: 'api/user.controller.ts',
      line: 42,
      message: 'Potential SQL injection',
      fix: 'Use parameterized queries via Prisma/Sequelize bindings',
    }

    const a: ReviewPayload = { ...base, issues: [issue] }
    const b: ReviewPayload = { ...base, issues: [issue] }

    const merged = mergeAndScore(a, b)
    expect(merged.overlap).toBe(1)
    expect(merged.union).toBe(1)
    expect(merged.score).toBeGreaterThanOrEqual(1)
    expect(merged.score).toBeLessThanOrEqual(10)
  })
})

describe('renderMarkdown', () => {
  it('includes score and sections', () => {
    const a: ReviewPayload = { ...base }
    const b: ReviewPayload = { ...base }
    const merged = mergeAndScore(a, b)
    const md = renderMarkdown(a, b, merged)

    expect(md).toContain('Dual Review Report')
    expect(md).toContain('Score:')
    expect(md).toContain('Cursor Review')
    expect(md).toContain('Claude Review')
  })
})


