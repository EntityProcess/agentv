# Copilot Log Evaluation Example

Demonstrates the `copilot-log` provider reading Copilot CLI session transcripts
from disk with the `skill-trigger` evaluator. **No LLM API key needed** — both
components are deterministic.

## Setup

### 1. Generate a Copilot session

Start a Copilot CLI session in the workspace directory and trigger the
`csv-analyzer` skill:

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

The `copilot-log` provider auto-discovers the latest session from
`~/.copilot/session-state/` and the `skill-trigger` evaluator checks
whether the expected skill was invoked.

## How it works

```
~/.copilot/session-state/{uuid}/events.jsonl
  ↓ copilot-log provider (reads from disk)
Message[] with tool calls
  ↓ skill-trigger evaluator (deterministic)
pass/fail verdict
```

## Workspace template

The workspace includes skills in `.copilot/skills/`:
- `csv-analyzer` — target skill for positive test
- `agentv-eval-writer`, `agentv-bench`, etc. — from agentv-dev plugin
