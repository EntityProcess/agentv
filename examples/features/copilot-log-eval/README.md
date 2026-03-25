# Copilot Log Evaluation Example

Demonstrates the `copilot-log` provider reading Copilot CLI session transcripts
from disk with deterministic evaluators. **No LLM API key needed.**

Evaluators used:
- `skill-trigger` — checks whether a specific skill was invoked
- `code-grader` — custom TypeScript grader inspecting the full `Message[]` with tool calls

## Setup

### 1. Generate a Copilot session

Start a Copilot CLI session in the workspace directory:

```bash
cd workspace/
copilot --model gpt-5-mini -p "Analyze this CSV file and tell me the top 5 months by revenue"
```

Or interactively:

```bash
copilot --model gpt-5-mini
> Analyze this CSV file and tell me the top 5 months by revenue
```

### 2. Run the eval

```bash
agentv eval evals/skill-trigger.EVAL.yaml --target copilot-log
```

The `before_all` hook runs `allagents workspace init` to sync the agentv-dev
plugin skills into the workspace. The `copilot-log` provider then auto-discovers
the latest session from `~/.copilot/session-state/` and runs all evaluators.

## How it works

```
allagents workspace init (before_all hook)
  ↓ syncs agentv-dev plugin skills from marketplace
~/.copilot/session-state/{uuid}/events.jsonl
  ↓ copilot-log provider (reads from disk)
Message[] with tool calls
  ├─ skill-trigger evaluator (deterministic) → pass/fail
  └─ code-grader (graders/transcript-quality.ts) → pass/fail
```

## Evaluators

### skill-trigger
Checks whether the `csv-analyzer` skill was (or was not) invoked.
Inspects tool call names and skill invocation events in the transcript.

### transcript-quality (code-grader)
Custom grader using `defineCodeGrader` from `@agentv/eval`. Validates:
1. Transcript contains assistant messages
2. Tool calls were recorded (inspects `Message[].toolCalls`)
3. Response addresses the CSV analysis question

## Workspace

Skills are sourced in two ways:
- **Bundled:** `csv-analyzer` in `.copilot/skills/` (example-specific)
- **Plugin:** agentv-dev skills synced via `allagents workspace init` from the
  `agentv` marketplace into `.github/skills/`
