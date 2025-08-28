export const DEFAULT_STDIO_BUFFER_BYTES = 10 * 1024 * 1024

export const DEFAULT_PROMPT_ARG = '-p'
export const DEFAULT_MODEL_ARG = '--model'
export const DEFAULT_OUTPUT_JSON_ARGS: ReadonlyArray<string> = Object.freeze([
  '--output-format',
  'json',
])

export const REVIEW_PROMPT = `You are a senior reviewer. You will receive a git diff via STDIN.
Output ONLY valid JSON, no Markdown, no prose:

{
  "issues": [{
    "category": "security|correctness|reliability|architecture|performance|tests|docs",
    "severity": "low|med|high",
    "file": "path",
    "line": 123,
    "message": "problem summary",
    "fix": "specific actionable fix"
  }],
  "summary": { "counts": { "low": 0, "med": 0, "high": 0 } }
}

Focus on a NestJS + Node.js + TypeScript + Postgres + Sequelize stack with event-driven/CQRS patterns:
- DTO/class-validator coverage, schema mismatch, input sanitization
- AuthZ/AuthN gaps, secrets handling, SQL injection risks
- Transaction boundaries, idempotency, saga/compensation concerns
- Repository pattern & separation of concerns
- Error handling, logging/observability
- Performance footguns (N+1, unbounded concurrency, blocking ops)
- Tests: missing cases, flaky patterns
- Docs/readability naming issues`


