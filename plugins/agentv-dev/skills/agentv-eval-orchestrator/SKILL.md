---
name: agentv-eval-orchestrator
description: Run AgentV evaluations by orchestrating eval subcommands. Use this skill when asked to run evals, evaluate an agent, or test prompt quality using agentv.
---

# AgentV Eval Orchestrator

Run AgentV evaluations using the orchestration prompt system.

## Usage

```bash
agentv prompt eval <eval-file.yaml>
```

This outputs a complete orchestration prompt with mode-specific instructions and all test IDs. **Follow its instructions exactly.**

The orchestration mode is controlled by the `AGENTV_PROMPT_EVAL_MODE` environment variable:

- **`agent`** (default) — You act as the candidate LLM and judge via two agents (`eval-candidate`, `eval-judge`). No API keys needed.
- **`cli`** — The CLI runs the evaluation end-to-end. Requires API keys.

## How it works

1. Run `agentv prompt eval <path>` to get your orchestration instructions
2. The output tells you exactly what to do based on the current mode
3. Follow the instructions — dispatch agents (agent mode) or run CLI commands (cli mode)
4. Results are written to `.agentv/results/` in JSONL format
