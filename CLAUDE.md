**FIRST ACTION**: Read @AGENTS.md before any task.

## Running Evals

Use `agentv pipeline` (not `eval run`) when the eval target is an AI agent (Claude, Codex, etc.):
- `agentv pipeline input <eval.yaml>` — extract inputs + grader configs
- Spawn executor subagents to run each test case
- `agentv pipeline grade <run-dir>` — run code graders
- `agentv pipeline bench <run-dir>` — merge scores + produce benchmark

Use `agentv eval` only for CLI-direct execution (local/script targets).
