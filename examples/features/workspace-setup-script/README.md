# Workspace Setup Extension

Demonstrates using a `beforeAll` lifecycle extension to clean and re-initialize an allagents workspace before evaluation runs, then register a project-scoped marketplace and sync plugin content.

## Problem

`allagents workspace init` fails if `.allagents/workspace.yaml` already exists. In CI and repeated eval runs, stale artifacts need to be cleaned before project-scoped plugin content is synced.

## Solution

A Node.js lifecycle extension exports `beforeAll(context)`. AgentV runs it after the authored `environment` recipe is prepared, so the extension can safely prepare local configuration without owning repo provisioning.

```
workspace-setup-script/
├── evals/
│   └── suite.yaml        # Eval with beforeAll extension
├── plugins/
│   └── my-plugin/               # Plugin content (AGENTS + prompt)
│       ├── AGENTS.md
│       └── .github/
│           └── prompts/
│               └── summarize-repo.prompt.md
├── marketplace/
│   └── .claude-plugin/
│       └── marketplace.json
├── scripts/
│   └── workspace-setup.mjs      # Lifecycle extension module
└── workspace-template/
    └── .allagents/
        └── workspace.yaml
```

## Eval YAML

Use top-level `extensions` for lifecycle hooks and keep authored testbed setup under `environment`:

```yaml
extensions:
  - file://../scripts/workspace-setup.mjs:beforeAll

environment:
  type: host
  workdir: ../workspace-template
  setup:
    command:
      - bash
      - ../scripts/materialize-repo.sh
      - ./my-repo
      - https://github.com/EntityProcess/agentv.git
      - main
    cwd: "."
```

The extension reads `context.workspace_path` and `context.eval_dir`, refreshes `.allagents/`, runs `allagents workspace init`, registers the local marketplace with `--scope project`, syncs plugins, and validates that expected artifacts exist.

## Referencing Plugin Files In Test Inputs

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

## How It Works

1. AgentV prepares the authored `environment`.
2. The environment setup materializes `my-repo/`.
3. The `beforeAll` extension removes stale `.allagents/` config and runs `npx allagents workspace init`.
4. The extension registers the local marketplace with `--scope project`.
5. `allagents workspace sync` installs `my-plugin@workspace-setup-script-marketplace`.
6. Required-file checks verify `AGENTS.md` and `.github/prompts/summarize-repo.prompt.md` exist.

## Cross-Platform Notes

The extension handles Windows by using `npx.cmd` instead of `npx` and launches subprocesses with:

- `stdio: ['ignore', 'inherit', 'inherit']`
- `shell: process.platform === 'win32'`
