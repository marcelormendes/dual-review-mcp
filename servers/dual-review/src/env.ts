import { z } from 'zod'

const envSchema = z.object({
  DUAL_REVIEW_STDIO_MAX_BUFFER: z.string().transform(v => Number(v)).optional(),
  DUAL_REVIEW_DEFAULT_MODEL: z.string().optional(),
})

/** Parses relevant environment variables once at startup. */
export const env = (() => envSchema.parse(process.env))()


