# Workspace Setup Script

Demonstrates using a `before_all` lifecycle hook to clean and re-initialize an allagents workspace before evaluation runs, including sourcing external files (like `AGENTS.md`) into the workspace via allagents `workspace.source`/`workspace.files`.

## Problem

`allagents workspace init` fails if `.allagents/workspace.yaml` already exists. In CI and repeated eval runs, stale artifacts need to be cleaned first. Without a wrapper, you'd need shell operators like `&&` (not cross-platform) or framework-level multi-command support.

## Solution

A generic Node.js script that any eval can reuse. It reads `workspace_path` from AgentV's stdin JSON, removes the stale `.allagents/` directory, and runs `allagents workspace init` with the template path passed via `--from`.

```
workspace-setup-script/
├── evals/
│   └── dataset.eval.yaml        # Eval with before_all hook
├── guidelines/
│   └── AGENTS.md                 # External agent guidelines (sourced by allagents)
├── scripts/
│   └── workspace-setup.mjs      # Generic setup script (reusable across evals)
└── workspace-template/
    └── .allagents/
        └── workspace.yaml       # Template for allagents init
```

## Sourcing files with allagents

The `guidelines/` directory lives outside `workspace-template/` as an external source. The `.allagents/workspace.yaml` uses `workspace.source` and `workspace.files` to tell allagents to copy specific files to the workspace root:

```yaml
# .allagents/workspace.yaml
workspace:
  source: ../guidelines/
  files:
    - AGENTS.md
```

The source path is relative to the workspace template root (parent of `.allagents/`). When `npx allagents workspace init --from` runs, it resolves `../guidelines/` from the template location and copies `AGENTS.md` to the workspace root. This pattern is useful for sourcing shared guidelines, prompt files, or skill definitions from a directory outside the workspace template.

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

Reference sourced files via `type: file` in test inputs to inject them into the agent's prompt:

```yaml
tests:
  - id: my-test
    input:
      - role: user
        content:
          - type: file
            value: ../guidelines/AGENTS.md
          - type: text
            value: Follow the instructions above.
```

The `type: file` path is resolved from the eval file's directory up to the repo root. This injects the file contents into the agent's prompt alongside the text instruction.

## How it works

1. AgentV copies `workspace-template/` to a pooled workspace
2. The setup script removes stale `.allagents/` config and runs `npx allagents workspace init`
3. Allagents reads `workspace.source`/`workspace.files` and copies `guidelines/AGENTS.md` to workspace root
4. The `--require AGENTS.md` check validates the artifact exists
5. AgentV clones repos and runs tests against the initialized workspace

## Reusing across evals

Copy `workspace-setup.mjs` to a shared `scripts/` directory. Each eval just points `--from` at its own template:

```yaml
# evals/my-eval/eval.yaml
workspace:
  hooks:
    before_all_tests:
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
