import { z } from 'zod'

const envSchema = z.object({
  DUAL_REVIEW_STDIO_MAX_BUFFER: z.string().transform(v => Number(v)).optional(),
  DUAL_REVIEW_DEFAULT_MODEL: z.string().optional(),
  DUAL_REVIEW_GIT_CWD: z.string().optional(),
  DUAL_REVIEW_DRY_RUN: z.string().optional().transform(v => (v === '1' || v === 'true')),
})

/** Parses relevant environment variables once at startup. */
export const env = (() => envSchema.parse(process.env))()


