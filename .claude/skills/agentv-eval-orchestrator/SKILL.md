---
name: agentv-eval-orchestrator
description: Run AgentV evaluations without API keys by orchestrating eval subcommands. Use this skill when asked to run evals, evaluate an agent, or test prompt quality using agentv.
---

# AgentV Eval Orchestrator

Run AgentV evaluations by acting as the LLM yourself — no API keys needed.

## Usage

```bash
agentv eval prompt <eval-file.yaml>
```

This outputs a complete orchestration prompt with step-by-step instructions and all eval case IDs. Follow the instructions it prints.

## When to use this vs `agentv eval run`

- **`agentv eval run`** — You have API keys configured. Runs everything end-to-end automatically.
- **`agentv eval prompt`** — No API keys. You orchestrate: get input, run the task yourself, judge the result.
