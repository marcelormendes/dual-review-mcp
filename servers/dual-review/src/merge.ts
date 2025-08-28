import { z } from 'zod'
export type Severity = 'low' | 'med' | 'high'

export interface ReviewIssue {
  category: 'security' | 'correctness' | 'reliability' | 'architecture' | 'performance' | 'tests' | 'docs'
  severity: Severity
  file: string
  line?: number
  message: string
  fix: string
}

export interface ReviewSummaryCounts {
  low: number
  med: number
  high: number
}

export interface ReviewSummary {
  counts: ReviewSummaryCounts
}

export interface ReviewPayload {
  issues: ReviewIssue[]
  summary: ReviewSummary
}

export const reviewPayloadSchema = z.object({
  issues: z.array(
    z.object({
      category: z.enum(['security', 'correctness', 'reliability', 'architecture', 'performance', 'tests', 'docs']),
      severity: z.enum(['low', 'med', 'high']),
      file: z.string(),
      line: z.number().optional(),
      message: z.string(),
      fix: z.string(),
    })
  ),
  summary: z.object({
    counts: z.object({ low: z.number(), med: z.number(), high: z.number() }),
  }),
})

/**
 * Parse and validate a review payload JSON string using Zod.
 */
export function parseReviewPayload(json: string): ReviewPayload {
  const value: unknown = JSON.parse(json)
  return reviewPayloadSchema.parse(value)
}

function defineFrozenRecord<K extends string, V>(obj: Record<K, V>): Readonly<Record<K, V>> {
  return Object.freeze(obj)
}

const categoryWeight = defineFrozenRecord<ReviewIssue['category'], number>({
  security: 1.0,
  correctness: 0.9,
  reliability: 0.9,
  architecture: 0.7,
  performance: 0.6,
  tests: 0.5,
  docs: 0.3,
})

const severityWeight = defineFrozenRecord<Severity, number>({
  low: 0.3,
  med: 0.6,
  high: 1.0,
})

function computeWeightedSum(review: ReviewPayload): number {
  return review.issues.reduce((sum, issue) => {
    const cw = categoryWeight[issue.category]
    const sw = severityWeight[issue.severity]
    return sum + cw * sw
  }, 0)
}

function issueKey(issue: ReviewIssue): string {
  return `${issue.category}|${issue.file}|${issue.message}`
}

export interface MergeResult {
  score: number
  overlap: number
  union: number
  cursorOnlyKeys: string[]
  claudeOnlyKeys: string[]
}

/**
 * Merge two review payloads and compute a bounded 1–10 score.
 * Emphasizes coverage and balance; penalizes many high-severity findings.
 */
export function mergeAndScore(cursor: ReviewPayload, claude: ReviewPayload): MergeResult {
  const cursorKeys = new Set(cursor.issues.map(issueKey))
  const claudeKeys = new Set(claude.issues.map(issueKey))

  const overlap = [...cursorKeys].filter(k => claudeKeys.has(k)).length
  const union = cursorKeys.size + claudeKeys.size - overlap || 1

  const weightedCursor = computeWeightedSum(cursor)
  const weightedClaude = computeWeightedSum(claude)
  const weightedSum = weightedCursor + weightedClaude

  const coverage = overlap / union
  const balance = 1 - Math.abs(cursorKeys.size - claudeKeys.size) / ((cursorKeys.size + claudeKeys.size) || 1)

  const highA = cursor.summary?.counts?.high ?? 0
  const highB = claude.summary?.counts?.high ?? 0
  const highPenalty = Math.min(0.3 + 0.07 * (highA + highB), 0.9)

  const rawScore = (0.55 * coverage + 0.35 * balance + 0.10 * Math.tanh(weightedSum / 10)) * 10
  const score = Math.max(1, Math.min(10, Math.round(rawScore * (1 - highPenalty)) || 1))

  const cursorOnly = [...cursorKeys].filter(k => !claudeKeys.has(k))
  const claudeOnly = [...claudeKeys].filter(k => !cursorKeys.has(k))

  return {
    score,
    overlap,
    union,
    cursorOnlyKeys: cursorOnly.slice(0, 50),
    claudeOnlyKeys: claudeOnly.slice(0, 50),
  }
}

/**
 * Render a concise Markdown report combining both reviews and merge metrics.
 */
export function renderMarkdown(cursor: ReviewPayload, claude: ReviewPayload, merge: MergeResult): string {
  const summarize = (r: ReviewPayload): string => {
    const c = r.summary?.counts ?? { low: 0, med: 0, high: 0 }
    return `Issues: ${r.issues.length} | High: ${c.high ?? 0}, Med: ${c.med ?? 0}, Low: ${c.low ?? 0}`
  }

  const md = `# Dual Review Report

**Score:** ${merge.score}/10

## Cursor Review
${summarize(cursor)}

## Claude Review
${summarize(claude)}

## Overlap
Matched: ${merge.overlap} of ${merge.union} unique issues

## Cursor-only (first 50)
${merge.cursorOnlyKeys.map(s => `- ${s}`).join('\n') || '- (none)'}

## Claude-only (first 50)
${merge.claudeOnlyKeys.map(s => `- ${s}`).join('\n') || '- (none)'}
`.trim()

  return md
}


