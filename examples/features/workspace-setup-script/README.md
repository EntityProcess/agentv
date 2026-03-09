# Workspace Setup Script

Demonstrates using a `before_all` lifecycle hook to clean and re-initialize an allagents workspace before evaluation runs.

## Problem

`allagents workspace init` fails if `.allagents/workspace.yaml` already exists. In CI and repeated eval runs, stale artifacts need to be cleaned first. Without a wrapper, you'd need shell operators like `&&` (not cross-platform) or framework-level multi-command support.

## Solution

A generic Node.js script that any eval can reuse. It reads `workspace_path` from AgentV's stdin JSON, removes the stale `.allagents/` directory, and runs `allagents workspace init` with the template path passed via `--from`.

```
workspace-setup-script/
├── evals/
│   └── dataset.eval.yaml        # Eval with before_all hook
├── scripts/
│   └── workspace-setup.mjs      # Generic setup script (reusable across evals)
└── workspace-template/
    ├── AGENTS.md                 # Agent guidelines (injected via type: file)
    └── .allagents/
        └── workspace.yaml       # Template for allagents init
```

## Eval YAML

The template path is passed as an argument. Use `--require` to validate that expected artifacts exist in the workspace after initialization:

```yaml
workspace:
  template: ./workspace-template
  hooks:
    before_all_tests:
      command:
        - node
        - ../scripts/workspace-setup.mjs
        - --from
        - ../workspace-template/.allagents/workspace.yaml
        - --require
        - AGENTS.md
```

The `--require` flag accepts one or more file paths (relative to the workspace root). If any required file is missing after `allagents workspace init`, the script exits with an error listing the missing files.

## Referencing workspace files in test inputs

Place files like `AGENTS.md` in the workspace template. They get copied to the workspace root, then reference them via `type: file` in test inputs:

```yaml
tests:
  - id: my-test
    input:
      - role: user
        content:
          - type: file
            value: ../workspace-template/AGENTS.md
          - type: text
            value: Follow the instructions above.
```

The `type: file` path is resolved from the eval file's directory up to the repo root. This injects the file contents into the agent's prompt alongside the text instruction.

## How it works

1. AgentV creates a temp workspace and sends `{"workspace_path": "..."}` on stdin
2. The script removes the `.allagents/` directory (stale config + artifacts)
3. The script runs `npx allagents workspace init` with the `--from` template
4. AgentV clones repos and runs tests against the initialized workspace

## Reusing across evals

Copy `workspace-setup.mjs` to a shared `scripts/` directory. Each eval just points `--from` at its own template:

```yaml
# evals/my-eval/eval.yaml
workspace:
  before_all:
    command:
      - node
      - ../../scripts/workspace-setup.mjs
      - --from
      - ./my-template/.allagents/workspace.yaml
```

## Cross-platform

The script handles Windows by using `npx.cmd` instead of `npx`.

Because the script first reads AgentV payload from stdin, it then launches `npx` with:

- `stdio: ['ignore', 'inherit', 'inherit']`
- `shell: process.platform === 'win32'`

This avoids a Windows-specific `spawnSync npx.cmd EINVAL` failure seen when stdin is inherited after being consumed in `before_all` hooks.
