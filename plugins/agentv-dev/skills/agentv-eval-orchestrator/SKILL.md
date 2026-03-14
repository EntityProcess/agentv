---
name: agentv-eval-orchestrator
description: "[DEPRECATED] This skill has been absorbed into the unified agentv-optimizer lifecycle skill. Use agentv-optimizer instead — it covers the full evaluation lifecycle: run → grade → compare → analyze → review → optimize → re-run."
description: >-
  Run AgentV evaluations against EVAL.yaml / .eval.yaml / evals.json files using the `agentv prompt eval` and `agentv eval` CLI commands.
  Use when asked to run AgentV evals, evaluate agent output quality with AgentV, execute an AgentV evaluation suite,
  or orchestrate AgentV eval subcommands.
  Do NOT use for creating or modifying SKILL.md files, packaging skills, optimizing skill trigger descriptions,
  or measuring skill-creator performance — those tasks belong to the skill-creator skill.
---

# AgentV Eval Orchestrator — DEPRECATED

> **This skill has been merged into the unified `agentv-optimizer` lifecycle skill.**
>
> All eval-orchestrator capabilities (workspace evaluation, multi-provider targets, multi-turn conversations, code judges, tool trajectory, agent/CLI modes, all eval formats) are now in **Phase 2 (Run Baseline)** of the `agentv-optimizer` skill.
>
> **Use `agentv-optimizer` instead.** It runs the same evaluations and adds grading, comparison, analysis, human review, and optimization phases on top.

## Quick Migration

| Before (eval-orchestrator) | After (agentv-optimizer) |
|---------------------------|-------------------------|
| "Run evals on this file" | Same prompt — agentv-optimizer handles it |
| "Evaluate my agent" | Same prompt — starts at Phase 2 automatically |
| `agentv prompt eval <file>` | Same command — used in Phase 2 |
| `agentv eval run <file>` | Same command — used in Phase 2 |

## Why the change

The eval-orchestrator ran evaluations but stopped there. Users had to manually switch to other skills for analysis and optimization. The unified lifecycle skill runs evaluations as part of a complete improvement loop — run, grade, compare, analyze, review, optimize, and re-run — without losing any eval-orchestrator capability.
