# Import Claude — Offline Transcript Grading

Demonstrates importing a Claude Code session transcript and grading it
offline with deterministic evaluators. **No LLM API key needed.**

Evaluators used:
- `code-grader` — custom TypeScript grader inspecting the full `Message[]` with tool calls

## Setup

### 1. Run a Claude Code session

Start a Claude Code session on any project:

```bash
claude -p "List all TypeScript files in this project"
```

### 2. Import the session transcript

```bash
agentv import claude --discover latest -o transcripts/session.jsonl
```

Or import a specific session:

```bash
# List available sessions
agentv import claude --list

# Import by session ID
agentv import claude --session-id <uuid> -o transcripts/session.jsonl
```

### 3. Run the eval

```bash
agentv eval evals/transcript-check.EVAL.yaml
```

## How it works

```
~/.claude/projects/<encoded-path>/<uuid>.jsonl
  ↓ agentv import claude (reads from disk, converts to Message[])
.agentv/transcripts/claude-<short-id>.jsonl
  ↓ code-grader (deterministic)
pass/fail
```

The import pipeline:
1. Discovers Claude Code sessions in `~/.claude/projects/`
2. Parses the JSONL transcript (user messages, assistant responses, tool calls)
3. Pairs `tool_use` blocks with `tool_result` responses
4. Aggregates token usage (last cumulative value per LLM request)
5. Writes a clean `Message[]` JSONL for evaluation

## Evaluators

### transcript-quality (code-grader)

Custom grader using `defineCodeGrader` from `@agentv/eval`. Validates:
1. Transcript contains at least one assistant message
2. Tool calls were recorded with outputs
3. No empty assistant messages
