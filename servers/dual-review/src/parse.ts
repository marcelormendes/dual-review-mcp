import { z } from 'zod'
import { parseReviewPayload, reviewPayloadSchema, type ReviewPayload } from './merge.js'

const envelopeSchema = z.object({
  type: z.string().optional(),
  result: z.string().optional(),
})

function stripCodeFences(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i
  const m = fence.exec(text)
  if (m && m[1]) return m[1].trim()
  // Fallback: try substring between first { and last }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) return text.slice(first, last + 1)
  return text.trim()
}

/**
 * Extract a ReviewPayload from arbitrary stdout:
 * - accepts plain schema JSON
 * - accepts a Claude-like JSON envelope with `result` string
 * - accepts code-fenced JSON blocks in either location
 */
export function extractReviewPayloadFromStdout(stdout: string): ReviewPayload {
  const raw = stdout.trim()

  // 1) Try direct parse into schema
  try {
    const obj = JSON.parse(raw)
    if (reviewPayloadSchema.safeParse(obj).success) return obj as ReviewPayload
  } catch {
    // ignore
  }

  // 2) Try JSON envelope with `result`
  try {
    const env = envelopeSchema.parse(JSON.parse(raw))
    if (env.result) {
      const inner = stripCodeFences(env.result)
      const payload = parseReviewPayload(inner)
      return payload
    }
  } catch {
    // ignore
  }

  // 3) Try stripping code fences from the whole stdout
  try {
    const inner = stripCodeFences(raw)
    const payload = parseReviewPayload(inner)
    return payload
  } catch {
    // ignore
  }

  throw new Error('Reviewer did not emit valid review JSON (issues/summary)')
}


