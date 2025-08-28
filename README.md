Dual-Review MCP (Cursor + Claude Code)

Overview

This repository provides a production-grade MCP (Model Context Protocol) server for Cursor that performs a dual code review over the current Git diff:

- Gets the current Git diff (staged by default)
- Requests a JSON review from Cursor’s model (via a Cursor Project Rule)
- Requests a second JSON review from Claude Code CLI (headless, JSON-only)
- Merges both results into a single Markdown report and computes a 1–10 score

The scoring is severity-weighted and tuned for NestJS/Event-driven architectures.

Quickstart

1) Install prerequisites

- Node.js 18+ and pnpm 9+
- Anthropic Claude Code CLI installed and `ANTHROPIC_API_KEY` set
- Git repo with staged changes to review

2) Install and build

```
pnpm i
pnpm lint
pnpm build
pnpm test
```

3) Start MCP server (for local manual run)

This command runs the server over stdio. Normally Cursor launches this automatically based on `.cursor/mcp.json`.

```
pnpm start
```

4) Configure Cursor

Cursor will pick up the MCP config from `.cursor/mcp.json` in this repo. Ensure the path to `servers/dual-review/dist/index.js` remains valid.

5) Use the Project Rule

The rule in `.cursor/rules/dual-review.mdc` orchestrates the workflow inside Cursor chat: it fetches the Git diff, asks Cursor’s model for a JSON review, calls the MCP tool to ask Claude for a second JSON review, then merges and renders the combined report.

Workspace structure

```
.
├─ .cursor/
│  ├─ mcp.json
│  └─ rules/
│     └─ dual-review.mdc
├─ servers/
│  └─ dual-review/
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ merge.ts
│     │  ├─ constants.ts
│     │  └─ env.ts
│     ├─ test/
│     │  └─ merge.test.ts
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ eslint.config.mjs
└─ README.md
```

Environment variables

- `ANTHROPIC_API_KEY` must be set for the Claude Code CLI to work.
- Optional:
  - `DUAL_REVIEW_STDIO_MAX_BUFFER` (bytes) to override default stdio buffer size (default: 10 MiB)
  - `DUAL_REVIEW_DEFAULT_MODEL` to set a default Claude model when not provided in the tool call

Running in Cursor

1) Open this repository in Cursor
2) Ensure MCP is enabled and the `dual-review` server is detected
3) Trigger the project rule “Dual Review” from the chat or run it per your Cursor setup

Notes

- The Claude CLI is invoked in non-interactive mode with JSON-only output. Make sure the CLI is on your PATH and authenticated.
- The report’s weighting emphasizes security/correctness/reliability for NestJS/CQRS/event-driven stacks.

Tutorial: Using Dual-Review MCP in Cursor

1) Prerequisites

- Cursor (latest) with MCP enabled
- Node 18+ and pnpm 9+
- Claude Code CLI installed and `ANTHROPIC_API_KEY` set
- A Git repo with staged changes

2) Install and build

```
pnpm i
pnpm build
```

3) Open in Cursor and verify MCP

- Open the repo folder in Cursor
- Check the Tools panel: you should see a server named `dual-review` with tools enabled
- `.cursor/mcp.json` is already configured to launch `servers/dual-review/dist/index.js`

4) Run the standard dual review (Cursor + Claude)

- In Cursor chat, run the Project Rule “Dual Review” (from `.cursor/rules/dual-review.mdc`). The rule:
  - Fetches the staged git diff (`dual-review:git_diff`)
  - Asks Cursor’s model to produce a JSON review (schema enforced in the rule)
  - Calls `dual-review:review_with_claude` to get Claude’s JSON review
  - Calls `dual-review:compare_reviews` to compute score and render the Markdown report

5) Reverse direction or other CLIs (Claude + Cursor/Codex/OpenAI)

- Use the generic tool `dual-review:review_with_command` to run any CLI in JSON-only mode. Example:

```
Tool: dual-review:review_with_command
Args:
{
  "diff": "<your-diff-string>",
  "command": "cursor",             // or "codex" / "openai" / other
  "promptArgName": "-p",
  "outputJsonArgs": ["--output-format", "json"],
  "modelArgName": "--model",
  "model": "<model-id>",
  "extraArgs": []
}
```

- Then pass the resulting JSON alongside Claude’s JSON into `dual-review:compare_reviews`.

6) Local manual run (optional)

```
pnpm start
```

This starts the MCP stdio server; Cursor normally manages this automatically.

Troubleshooting

- “claude: command not found”: ensure Claude CLI is installed and on PATH; ensure `ANTHROPIC_API_KEY` is set and valid.
- “Invalid JSON” in reviews: re-run the reviewer step; the rule enforces a strict schema, so any deviation will be rejected.
- “No issues found / empty diff”: ensure you have staged changes; try `git add -p` and re-run.
- MCP server not visible in Cursor: close and reopen the project or reload MCP Tools; ensure `.cursor/mcp.json` path is valid.


