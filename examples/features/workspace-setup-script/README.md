# Workspace Setup Script

Demonstrates using a `before_all` lifecycle hook to run a setup script before evaluation.

## Problem

Multi-step workspace initialization (e.g., remove stale config + run `allagents workspace init`) requires a wrapper script. Without one, you'd need framework-level multi-command support or shell operators like `&&`.

## Solution

A small Node.js script that AgentV calls via `before_all`. AgentV sends workspace context as JSON on stdin — the script reads `workspace_path`, cleans up stale files, and runs the initialization command.

```
workspace-setup-script/
├── evals/
│   └── dataset.eval.yaml        # Eval with before_all hook
├── scripts/
│   └── workspace-setup.mjs      # Setup script (reads stdin, cleans, inits)
└── workspace-template/
    └── .allagents/
        └── workspace.yaml       # Template for allagents init
```

## How it works

1. AgentV creates a temp workspace and sends `{"workspace_path": "..."}` on stdin
2. The script removes `.allagents/workspace.yaml` (stale from previous runs)
3. The script runs `npx allagents workspace init` with the template
4. AgentV clones repos and runs tests against the initialized workspace

## Eval YAML

```yaml
workspace:
  template: ./workspace-template
  before_all:
    command:
      - node
      - ../scripts/workspace-setup.mjs
```

## Stdin JSON format

AgentV sends this JSON on stdin to all lifecycle scripts:

```json
{
  "workspace_path": "/tmp/agentv-ws-abc123",
  "test_id": "__before_all__",
  "eval_run_id": "run-xyz",
  "case_input": null,
  "case_metadata": null
}
```

## Cross-platform

The script handles Windows by using `npx.cmd` instead of `npx`. Each command is spawned directly via `spawnSync` (no shell assumption).
