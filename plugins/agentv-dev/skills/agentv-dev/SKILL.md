---
name: agentv-dev
description: >-
  AgentV CLI skills for evaluating, optimizing, and governing AI agents.
  Triggers: run evals, benchmark agents, write evals, review evals, analyze traces,
  optimize prompts, governance linting.
  Covers: eval running, eval writing, eval review, trace analysis, description
  optimization, autoresearch, and governance compliance.
---

The full skill content is bundled with the AgentV CLI and always version-matched to it.
Load the specific skill you need:

```bash
agentv skills get <skill-name>
```

## Available Skills

| Skill | Command | Use when |
|-------|---------|----------|
| agentv-bench | `agentv skills get agentv-bench` | Run evals, benchmark agents, optimize against evals, compare targets, autoresearch |
| agentv-eval-writer | `agentv skills get agentv-eval-writer` | Write, edit, or validate eval YAML files |
| agentv-eval-review | `agentv skills get agentv-eval-review` | Review, lint, or check eval quality before committing |
| agentv-governance | `agentv skills get agentv-governance` | Author or lint governance blocks (OWASP, MITRE, EU AI Act, ISO 42001) |
| agentv-trace-analyst | `agentv skills get agentv-trace-analyst` | Analyze eval traces, find regressions, inspect tool trajectories |

## Quick Start

1. Ensure `agentv` CLI is on PATH (run `agentv --help` to verify)
2. Pick the skill from the table above
3. Run `agentv skills get <skill-name>` to load it
4. Follow the instructions in the loaded skill

## CLI Location

If `agentv` is not on PATH, check:
- `node_modules/.bin/agentv` (project-local install)
- `~/.local/bin/agentv` (global user install)
- Run from source: `bun apps/cli/src/cli.ts <command>`
