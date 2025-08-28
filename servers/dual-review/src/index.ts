#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { z } from "zod"
import { mergeAndScore, renderMarkdown, parseReviewPayload } from "./merge.js"
import { extractReviewPayloadFromStdout } from './parse.js'
import { DEFAULT_STDIO_BUFFER_BYTES, DEFAULT_MODEL_ARG, DEFAULT_OUTPUT_JSON_ARGS, DEFAULT_PROMPT_ARG, REVIEW_PROMPT } from './constants.js'
import { env } from './env.js'
import { computeDiff } from './git.js'

const server = new McpServer({
  name: "dual-review-mcp",
  version: "0.1.0",
})

const SHOW_ADVANCED = process.env.DUAL_REVIEW_SHOW_ADVANCED === '1' || process.env.DUAL_REVIEW_SHOW_ADVANCED === 'true'

function runZeroArgAlias(): { content: { type: 'text', text: string }[] } {
  const cwd = env.DUAL_REVIEW_GIT_CWD ?? process.cwd()
  const diff = computeDiff({ cwd, staged: true, maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES })

  const secondaryCli = process.env.CURSOR_CLI ?? 'cursor-agent'
  const cursorArgs: string[] = ['-']
  const pCursor: SpawnSyncReturns<string> = spawnSync(secondaryCli, cursorArgs, {
    input: `${REVIEW_PROMPT}\n\n${diff}`,
    encoding: "utf8",
    maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES,
    env: process.env,
    cwd,
  })
  if (pCursor.status !== 0) {
    const stderrText = pCursor.stderr
    throw new Error(stderrText || `${secondaryCli} CLI failed`)
  }
  const cursorJsonText: string = pCursor.stdout.trim()

  const claudeArgs = [DEFAULT_PROMPT_ARG, REVIEW_PROMPT, ...DEFAULT_OUTPUT_JSON_ARGS]
  const pClaude: SpawnSyncReturns<string> = spawnSync("claude", claudeArgs, {
    input: diff,
    encoding: "utf8",
    maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES,
    env: process.env,
    cwd,
  })
  if (pClaude.status !== 0) {
    const stderrText = pClaude.stderr
    throw new Error(stderrText || "claude CLI failed")
  }
  const claudeJsonText: string = pClaude.stdout.trim()

  const a = extractReviewPayloadFromStdout(cursorJsonText)
  const b = extractReviewPayloadFromStdout(claudeJsonText)
  const merged = mergeAndScore(a, b)
  const md = renderMarkdown(a, b, merged)

  return {
    content: [
      { type: "text", text: JSON.stringify({ score: merged.score }) },
      { type: "text", text: md },
    ],
  }
}

if (SHOW_ADVANCED) server.tool(
  "git_diff",
  {
    description: "Return the current git diff (staged by default)",
    inputSchema: {
      type: "object",
      properties: { staged: { type: "boolean", default: true } },
    },
  },
  (args: unknown): { content: { type: 'text', text: string }[] } => {
    const input = z.object({ staged: z.boolean().optional().default(true) }).parse(args)
    const cwd = env.DUAL_REVIEW_GIT_CWD ?? process.cwd()
    const out = computeDiff({ cwd, staged: Boolean(input.staged), maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES })
    return { content: [{ type: "text", text: out || "" }] }
  }
)

if (SHOW_ADVANCED) server.tool(
  "review_with_claude",
  {
    description:
      "Run Claude Code CLI on a diff (stdin) and return JSON review for NestJS/TS/event-driven/Sequelize",
    inputSchema: {
      type: "object",
      properties: {
        diff: { type: "string" },
        model: { type: "string", description: "Claude model override" },
      },
      required: ["diff"],
    },
  },
  (args: unknown): { content: { type: 'text', text: string }[] } => {
    const { diff, model } = z.object({ diff: z.string(), model: z.string().optional() }).parse(args)
    const cliArgs = [DEFAULT_PROMPT_ARG, REVIEW_PROMPT, ...DEFAULT_OUTPUT_JSON_ARGS]
    if (model ?? env.DUAL_REVIEW_DEFAULT_MODEL) cliArgs.push(DEFAULT_MODEL_ARG, model ?? env.DUAL_REVIEW_DEFAULT_MODEL!)

    const proc: SpawnSyncReturns<string> = spawnSync("claude", cliArgs, {
      input: diff,
      encoding: "utf8",
      maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES,
      env: process.env,
    })

    if (proc.status !== 0) {
      const stderrText = proc.stderr
      throw new Error(stderrText || "claude CLI failed")
    }

    const payload = extractReviewPayloadFromStdout(proc.stdout)
    return { content: [{ type: "text", text: JSON.stringify(payload) }] }
  }
)

if (SHOW_ADVANCED) server.tool(
  "compare_reviews",
  {
    description: "Combine two JSON reviews and compute a 1–10 score + markdown report",
    inputSchema: {
      type: "object",
      properties: {
        cursorJson: { type: "string" },
        claudeJson: { type: "string" },
      },
      required: ["cursorJson", "claudeJson"],
    },
  },
  (args: unknown): { content: { type: 'text', text: string }[] } => {
    const { cursorJson, claudeJson } = z.object({ cursorJson: z.string(), claudeJson: z.string() }).parse(args)
    const a = parseReviewPayload(cursorJson)
    const b = parseReviewPayload(claudeJson)

    const merged = mergeAndScore(a, b)
    const md = renderMarkdown(a, b, merged)

    return {
      content: [
        { type: "text", text: JSON.stringify({ score: merged.score }) },
        { type: "text", text: md },
      ],
    }
  }
)

// Generic CLI reviewer for symmetry (e.g., cursor-cli, codex-cli, openai-cli)
if (SHOW_ADVANCED) server.tool(
  "review_with_command",
  {
    description: "Run an arbitrary CLI in headless mode on a diff (stdin) and return JSON review",
    inputSchema: {
      type: "object",
      properties: {
        diff: { type: "string" },
        command: { type: "string", description: "Binary name, e.g., cursor, codex, openai" },
        promptArgName: { type: "string", description: "Flag name for prompt", default: "-p" },
        outputJsonArgs: {
          type: "array",
          items: { type: "string" },
          description: "Args to request JSON output",
          default: ["--output-format", "json"],
        },
        extraArgs: {
          type: "array",
          items: { type: "string" },
          description: "Additional CLI args",
          default: [],
        },
        model: { type: "string", description: "Optional model ID" },
        modelArgName: { type: "string", description: "Flag name for model", default: "--model" },
      },
      required: ["diff", "command"],
    },
  },
  (inputRaw: unknown): { content: { type: 'text', text: string }[] } => {
    const input = z.object({
      diff: z.string(),
      command: z.string(),
      promptArgName: z.string().default('-p'),
      outputJsonArgs: z.array(z.string()).default(["--output-format", "json"]),
      extraArgs: z.array(z.string()).default([]),
      model: z.string().optional(),
      modelArgName: z.string().default('--model'),
    }).parse(inputRaw)

    const cliArgs: string[] = [
      input.promptArgName,
      REVIEW_PROMPT,
      ...input.outputJsonArgs,
      ...input.extraArgs,
    ]
    if (input.model) {
      cliArgs.push(input.modelArgName, input.model)
    }

    const proc: SpawnSyncReturns<string> = spawnSync(input.command, cliArgs, {
      input: input.diff,
      encoding: "utf8",
      maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES,
      env: process.env,
    })

    if (proc.status !== 0) {
      const stderrText = proc.stderr
      throw new Error(stderrText || `${input.command} failed`)
    }

    const payload = extractReviewPayloadFromStdout(proc.stdout)
    return { content: [{ type: "text", text: JSON.stringify(payload) }] }
  }
)

// One-shot runner for zero-config usage (no Project Rule needed):
// - Gets git diff
// - Runs Claude CLI review
// - Runs a second CLI review (e.g., cursor/codex/openai)
// - Merges and returns score + markdown
if (SHOW_ADVANCED) server.tool(
  "run_dual_review",
  {
    description: "One-shot dual review: git diff + Claude + secondary CLI + merged report",
    inputSchema: {
      type: "object",
      properties: {
        staged: { type: "boolean", default: true },
        claudeModel: { type: "string", description: "Claude model override" },
        secondaryCommand: { type: "string", description: "Binary name for second reviewer (cursor/codex/openai)" },
        secondaryModel: { type: "string", description: "Model for second reviewer" },
        promptArgName: { type: "string", default: "-p" },
        outputJsonArgs: { type: "array", items: { type: "string" }, default: ["--output-format", "json"] },
        modelArgName: { type: "string", default: "--model" },
        extraArgs: { type: "array", items: { type: "string" }, default: [] },
      },
    },
  },
  (raw: unknown): { content: { type: 'text', text: string }[] } => {
    const input = z.object({
      staged: z.boolean().optional().default(true),
      claudeModel: z.string().optional(),
      secondaryCommand: z.string().optional().default('cursor'),
      secondaryModel: z.string().optional(),
      promptArgName: z.string().default('-p'),
      outputJsonArgs: z.array(z.string()).default(["--output-format", "json"]),
      modelArgName: z.string().default('--model'),
      extraArgs: z.array(z.string()).default([]),
    }).parse(raw)

    // 1) Diff
    const cwd = env.DUAL_REVIEW_GIT_CWD ?? process.cwd()
    const diff = computeDiff({ cwd, staged: Boolean(input.staged), maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES })

    // 2) Claude review
    const claudeArgs = [DEFAULT_PROMPT_ARG, REVIEW_PROMPT, ...DEFAULT_OUTPUT_JSON_ARGS]
    const modelToUse = input.claudeModel ?? env.DUAL_REVIEW_DEFAULT_MODEL
    if (modelToUse) claudeArgs.push(DEFAULT_MODEL_ARG, modelToUse)
    const pClaude: SpawnSyncReturns<string> = spawnSync("claude", claudeArgs, {
      input: diff,
      encoding: "utf8",
      maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES,
      env: process.env,
      cwd,
    })
    if (pClaude.status !== 0) {
      const stderrText = pClaude.stderr
      throw new Error(stderrText || "claude CLI failed")
    }
    const claudeJsonText: string = pClaude.stdout.trim()

    // 3) Secondary CLI review
    const secArgs: string[] = [
      input.promptArgName,
      REVIEW_PROMPT,
      ...input.outputJsonArgs,
      ...input.extraArgs,
    ]
    if (input.secondaryModel) secArgs.push(input.modelArgName, input.secondaryModel)
    const pSec: SpawnSyncReturns<string> = spawnSync(input.secondaryCommand, secArgs, {
      input: diff,
      encoding: "utf8",
      maxBuffer: env.DUAL_REVIEW_STDIO_MAX_BUFFER ?? DEFAULT_STDIO_BUFFER_BYTES,
      env: process.env,
      cwd,
    })
    if (pSec.status !== 0) {
      const stderrText = pSec.stderr
      throw new Error(stderrText || `${input.secondaryCommand} failed`)
    }
    const secondaryJsonText: string = pSec.stdout.trim()

    // Validate shape (reuse schema from above anonymously)
    const schema = z.object({
      issues: z.array(
        z.object({
          category: z.enum(["security", "correctness", "reliability", "architecture", "performance", "tests", "docs"]),
          severity: z.enum(["low", "med", "high"]),
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
    schema.parse(JSON.parse(claudeJsonText))
    schema.parse(JSON.parse(secondaryJsonText))

    // 4) Merge
    const a = parseReviewPayload(secondaryJsonText)
    const b = parseReviewPayload(claudeJsonText)
    const merged = mergeAndScore(a, b)
    const md = renderMarkdown(a, b, merged)

    return {
      content: [
        { type: "text", text: JSON.stringify({ score: merged.score }) },
        { type: "text", text: md },
      ],
    }
  }
)

// Simplest zero-arg alias: staged diff → Cursor CLI → Claude CLI → merged report
if (SHOW_ADVANCED) server.tool(
  "dual_review_now",
  {
    description: "Run staged diff through Cursor CLI then Claude CLI and return merged report (no args)",
    inputSchema: { type: "object", properties: {} },
  },
  (): { content: { type: 'text', text: string }[] } => runZeroArgAlias()
)

// Preferred alias: "dual-review"
server.tool(
  "dual-review",
  { description: "One-command dual review (no args)", inputSchema: { type: "object", properties: {} } },
  (): { content: { type: 'text', text: string }[] } => runZeroArgAlias()
)

// Single-command entrypoint used by NPX launcher too
if (SHOW_ADVANCED) server.tool(
  "run", // minimal name for one message/command use
  {
    description: "One-command dual review (no args): uses staged diff, Cursor CLI, Claude CLI",
    inputSchema: { type: "object", properties: {} },
  },
  (): { content: { type: 'text', text: string }[] } => runZeroArgAlias()
)

const transport = new StdioServerTransport()
await server.connect(transport)


