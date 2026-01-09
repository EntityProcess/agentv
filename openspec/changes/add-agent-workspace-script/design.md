# Design: Agent Workspace Scaffold

## Summary
Provide an AgentV-supported way to create and update a reproducible “agent workspace” directory populated from one or more sources (local folders and/or git repos), and a way to point agentic target providers at that directory as their working directory.

## Key observations (from repo research)
- Subagent provisioning writes a minimal `.code-workspace` file and `.github/agents/wakeup.md` per subagent directory (see `subagent/src/vscode/provision.ts`).
- AgentV already supports per-target working directories:
  - `cli`: `config.cwd` is passed to `exec` (see `packages/core/src/evaluation/providers/cli.ts`).
  - `codex`: defaults to a temp workspace unless `config.cwd` is set (see `packages/core/src/evaluation/providers/codex.ts`).
  - `claude-code`: defaults to `process.cwd()` unless `config.cwd` is set (see `packages/core/src/evaluation/providers/claude-code.ts`) to preserve Claude Code auth.
  - `vscode`: uses `subagent` and can accept a `workspaceTemplate` override (see `packages/core/src/evaluation/providers/vscode.ts`).
- File resolution for guideline/prompt file references includes `process.cwd()` as a search root (see `packages/core/src/evaluation/file-utils.ts`).

## Relevant pattern to borrow (OpenSkills)
The only OpenSkills concept we borrow is **symlink mode** for local development: instead of copying files into the workspace, create symlinks so edits in the source repo immediately reflect in the workspace.

## CLI surface
### New commands
`agentv workspace create --out <dir> [--config <path>] [--force]`

- Creates the workspace root directory.
- Writes a workspace config YAML file (default: `<out>/.agentv/workspace.yaml`).

`agentv workspace sync --config <path> [--mode copy|symlink]`

- Syncs all configured sources into the workspace root.
- `--mode` overrides config for one run; default is `copy`.

### Workspace config file
The workspace config drives what gets synced into the workspace root.

Default path: `<workspaceRoot>/.agentv/workspace.yaml`.

High-level shape (illustrative):
```yaml
version: 1
workspace_root: .
mode: copy  # or symlink

sources:
  - id: wtg-prompts
    type: local
    root: D:/GitHub/WiseTechGlobal/WTG.AI.Prompts
    include:
      - plugins/base/prompts
      - plugins/development/prompts
    dest: vendor/wtg-ai-prompts

  - id: upstream-prompts
    type: git
    repo: https://github.com/WiseTechGlobal/WTG.AI.Prompts.git
    ref: main
    include:
      - plugins/base/prompts
    dest: vendor/upstream
```

Notes:
- This is intentionally generic: sources can sync any folders (not “skills” specifically).
- For `git` sources, syncing specific folders SHOULD be implemented using `git` + sparse checkout.

### New eval flag
`agentv eval ... --workspace-root <dir>`

When supplied, AgentV will treat `<dir>` as the default execution root for agentic target providers.

## Provider override rules
- If a target already sets `cwd`, keep it.
- If `--workspace-root` is set and the target does not set `cwd`, then:
  - `cli`, `codex`, `claude-code`, `pi-coding-agent`: set `cwd = workspaceRoot`.
- For VS Code targets:
  - If `workspaceTemplate` is not set, synthesize a workspace template with `folders: [{ path: workspaceRoot }]`.
  - If `workspaceTemplate` is already set, keep it.

## Implementation placement
- Workspace creation (filesystem copy) belongs in the CLI layer (`apps/cli`) to keep `@agentv/core` minimal.
- Workspace-root injection can be implemented either:
  - in CLI (post-parse, before evaluation run), or
  - in core target resolution as an optional override parameter.

Preference: do injection in CLI so the core remains a pure parser/normalizer, and the behavior remains clearly tied to the `agentv eval` command.

## Windows considerations
- Use Node `fs/promises` + `path` only.
- Treat `workspaceTemplate` as JSON; when embedding absolute paths, use standard `C:\\...` JSON escaping.

## Open questions
- Should `agentv workspace create` include flags to add initial sources inline (e.g. `--add-local <path> --include <relpath>`), or keep it as “create empty config, user edits YAML” for v1?
- Should `agentv workspace sync` support per-source filters (e.g. `--source <id>`), or only “sync all” for v1?
