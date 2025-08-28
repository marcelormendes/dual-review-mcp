import { describe, it, expect } from 'vitest'
import { extractReviewPayloadFromStdout } from '../src/parse.js'

const plain = JSON.stringify({ issues: [], summary: { counts: { low: 0, med: 0, high: 0 } } })
const fenced = '```json\n' + plain + '\n```'
const envelope = JSON.stringify({ type: 'result', result: fenced })

describe('extractReviewPayloadFromStdout', () => {
  it('parses plain json', () => {
    const r = extractReviewPayloadFromStdout(plain)
    expect(r.summary.counts.low).toBe(0)
  })

  it('parses code-fenced json', () => {
    const r = extractReviewPayloadFromStdout(fenced)
    expect(r.summary.counts.med).toBe(0)
  })

  it('parses envelope with result string containing code fences', () => {
    const r = extractReviewPayloadFromStdout(envelope)
    expect(r.summary.counts.high).toBe(0)
  })
})



