#!/usr/bin/env node
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { DEFAULT_MODEL_ARG, DEFAULT_OUTPUT_JSON_ARGS, DEFAULT_PROMPT_ARG, DEFAULT_STDIO_BUFFER_BYTES, REVIEW_PROMPT } from './constants.js'
import { env } from './env.js'
import { computeDiff } from './git.js'
import { mergeAndScore, parseReviewPayload, renderMarkdown } from './merge.js'
import { z } from 'zod'

interface CliOptions {
  cwd: string
  staged: boolean
  secondaryCommand: string
  claudeCommand: string
  promptArgName: string
  outputJsonArgs: string[]
  modelArgName: string
  extraArgs: string[]
}

function parseArgs(argv: string[]): CliOptions {
  let cwd = env.DUAL_REVIEW_GIT_CWD ?? process.cwd()
  let staged = true
  let secondaryCommand = 'cursor'
  let claudeCommand = 'claude'
  let promptArgName = DEFAULT_PROMPT_ARG
  let outputJsonArgs: string[] = [...DEFAULT_OUTPUT_JSON_ARGS]
  let modelArgName = DEFAULT_MODEL_ARG
  const extraArgs: string[] = []

  for (const arg of argv) {
    if (arg === '--unstaged') staged = false
    else if (arg.startsWith('--cwd=')) cwd = arg.slice('--cwd='.length)
    else if (arg.startsWith('--secondary=')) secondaryCommand = arg.slice('--secondary='.length)
    else if (arg.startsWith('--claudeCommand=')) claudeCommand = arg.slice('--claudeCommand='.length)
    else if (arg.startsWith('--promptArgName=')) promptArgName = arg.slice('--promptArgName='.length)
    else if (arg.startsWith('--outputJsonArgs=')) {
      const raw = arg.slice('--outputJsonArgs='.length)
      outputJsonArgs = raw.split(',').filter(Boolean)
    }
    else if (arg.startsWith('--modelArgName=')) modelArgName = arg.slice('--modelArgName='.length)
    else if (arg.startsWith('--extra=')) extraArgs.push(arg.slice('--extra='.length))
  }

  return { cwd, staged, secondaryCommand, claudeCommand, promptArgName, outputJsonArgs, modelArgName, extraArgs }
}

function runLocal(): void {
  const opts = parseArgs(process.argv.slice(2))
  const maxBuffer = env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES

  const diff = computeDiff({ cwd: opts.cwd, staged: opts.staged, maxBuffer })

  if (env.DUAL_REVIEW_DRY_RUN) {
    const md = `# Dual Review Report (dry-run)\n\nDiff bytes: ${Buffer.byteLength(diff, 'utf8')}\n\nThis is a dry-run. Set ANTHROPIC_API_KEY and ensure 'cursor' and 'claude' CLIs are on PATH to run a real review.`
    process.stdout.write(md + '\n')
    return
  }

  // If the user passes a "-" style stdin mode, treat it specially
  const stdinMode = opts.extraArgs.includes('-') || opts.secondaryCommand.includes('cursor-agent')
  const cursorArgs: string[] = stdinMode ? ['-'] : [opts.promptArgName, REVIEW_PROMPT, ...opts.outputJsonArgs, ...opts.extraArgs]
  const pCursor: SpawnSyncReturns<string> = spawnSync(opts.secondaryCommand, cursorArgs, {
    input: stdinMode ? `${REVIEW_PROMPT}\n\n${diff}` : diff,
    encoding: 'utf8',
    maxBuffer,
    env: process.env,
    cwd: opts.cwd,
  })
  if (pCursor.status !== 0) {
    const stderrText = pCursor.stderr
    throw new Error(stderrText || `${opts.secondaryCommand} CLI failed`)
  }
  const cursorOut = (pCursor.stdout || '').toString().trim()
  if (!cursorOut.startsWith('{') && !cursorOut.startsWith('[')) {
    throw new Error(`Secondary CLI did not emit JSON. First 120 chars: ${cursorOut.slice(0, 120)}`)
  }
  const cursorJsonText: string = cursorOut

  const claudeArgs = [opts.promptArgName, REVIEW_PROMPT, ...opts.outputJsonArgs]
  const modelToUse = env.DUAL_REVIEW_DEFAULT_MODEL
  if (modelToUse) claudeArgs.push(opts.modelArgName, modelToUse)
  const pClaude: SpawnSyncReturns<string> = spawnSync(opts.claudeCommand, claudeArgs, {
    input: diff,
    encoding: 'utf8',
    maxBuffer,
    env: process.env,
    cwd: opts.cwd,
  })
  if (pClaude.status !== 0) {
    const stderrText = pClaude.stderr
    throw new Error(stderrText || `${opts.claudeCommand} CLI failed`)
  }
  const claudeOut = (pClaude.stdout || '').toString().trim()
  if (!claudeOut.startsWith('{') && !claudeOut.startsWith('[')) {
    throw new Error(`Claude CLI did not emit JSON. First 120 chars: ${claudeOut.slice(0, 120)}`)
  }
  const claudeJsonText: string = claudeOut

  const schema = z.object({
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
    summary: z.object({ counts: z.object({ low: z.number(), med: z.number(), high: z.number() }) }),
  })

  schema.parse(JSON.parse(cursorJsonText))
  schema.parse(JSON.parse(claudeJsonText))

  const a = parseReviewPayload(cursorJsonText)
  const b = parseReviewPayload(claudeJsonText)
  const merged = mergeAndScore(a, b)
  const md = renderMarkdown(a, b, merged)

  // Print markdown report to stdout
  process.stdout.write(md + '\n')
}

try {
  runLocal()
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`[dual-review-local] ${message}\n`)
  process.exitCode = 1
}


