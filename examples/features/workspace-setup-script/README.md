# Workspace Setup Script

Demonstrates using a `before_all` lifecycle hook to clean and re-initialize an allagents workspace before evaluation runs, then register a project-scoped marketplace and sync plugin content (including prompt files).

## Problem

`allagents workspace init` fails if `.allagents/workspace.yaml` already exists. In CI and repeated eval runs, stale artifacts need to be cleaned first. Without a wrapper, you'd need shell operators like `&&` (not cross-platform) or framework-level multi-command support.

## Solution

A generic Node.js script that any eval can reuse. It reads `workspace_path` from AgentV's stdin JSON, removes stale `.allagents/` state, runs `allagents workspace init --from`, registers a project-scoped marketplace, then runs `allagents workspace sync`.

```
workspace-setup-script/
├── evals/
│   └── dataset.eval.yaml        # Eval with before_all hook
├── plugins/
│   └── my-plugin/               # Plugin content (AGENTS + prompt)
│       ├── AGENTS.md             # Agent guidelines
│       └── .github/
│           └── prompts/
│               └── summarize-repo.prompt.md
├── marketplace/
│   └── .claude-plugin/
│       └── marketplace.json     # Local marketplace manifest
├── scripts/
│   └── workspace-setup.mjs      # Generic setup script (reusable across evals)
└── workspace-template/
    └── .allagents/
        └── workspace.yaml       # Template for allagents init
```

## Plugin Installation via Project Marketplace

The `.allagents/workspace.yaml` installs a plugin from a named marketplace:

```yaml
# .allagents/workspace.yaml
plugins:
  - my-plugin@workspace-setup-script-marketplace
```

The setup script registers that marketplace using project scope:

```bash
npx --yes allagents plugin marketplace add ../marketplace --scope project
```

This matches the project-scoped marketplace flow introduced in `allagents` (PR #224).

## Eval YAML

The template path and local marketplace path are passed as arguments. Use `--require` to validate expected artifacts after sync:

```yaml
workspace:
  template: ./workspace-template
  hooks:
    before_all:
      command:
        - node
        - ../scripts/workspace-setup.mjs
        - --from
        - ../workspace-template/.allagents/workspace.yaml
        - --marketplace-source
        - ../marketplace
        - --require
        - AGENTS.md
        - --require
        - .github/prompts/summarize-repo.prompt.md
```

The `--require` flag accepts one or more file paths (relative to the workspace root). If any required file is missing after `allagents workspace init`, the script exits with an error listing the missing files.

## Referencing plugin files in test inputs

Reference plugin files via `type: file` in test inputs to inject them into the agent's prompt:

```yaml
tests:
  - id: summarize-repo
    input:
      - role: user
        content:
          - type: file
            value: ../plugins/my-plugin/AGENTS.md
          - type: file
            value: ../plugins/my-plugin/.github/prompts/summarize-repo.prompt.md
```

The `type: file` path is resolved from the eval file's directory up to the repo root. This injects the file contents into the agent's prompt alongside any text instructions.

## How it works

1. AgentV copies `workspace-template/` to a pooled workspace
2. The setup script removes stale `.allagents/` config and runs `npx allagents workspace init`
3. The setup script registers the local marketplace with `--scope project`
4. `allagents workspace sync` installs `my-plugin@workspace-setup-script-marketplace`
5. `--require` checks verify `AGENTS.md` and `.github/prompts/summarize-repo.prompt.md` exist
6. AgentV clones repos and runs tests against the initialized workspace

## Cross-platform

The script handles Windows by using `npx.cmd` instead of `npx`.

Because the script first reads AgentV payload from stdin, it then launches `npx` with:

- `stdio: ['ignore', 'inherit', 'inherit']`
- `shell: process.platform === 'win32'`

This avoids a Windows-specific `spawnSync npx.cmd EINVAL` failure seen when stdin is inherited after being consumed in `before_all` hooks.
