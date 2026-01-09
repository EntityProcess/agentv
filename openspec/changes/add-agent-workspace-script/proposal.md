# Change: Add agent workspace sync for agentic targets

## Why
Agentic target providers (VS Code via subagent, Codex CLI, Claude Code CLI, and generic CLI targets) commonly need a consistent working directory that already contains prompt files and other agent assets (prompts, instructions, templates, etc.). Today users must manually curate a folder and then manually configure `cwd`/workspace settings per target. This is error-prone and makes evals harder to reproduce.

## What Changes
- Add a workspace sync utility to AgentV that can populate a workspace folder from multiple sources (local paths or git repositories) based on a YAML config file.
- Add CLI commands:
  - `agentv workspace create` to create an initial workspace directory and write the config file
  - `agentv workspace sync` to update/refresh all configured sources into the workspace directory (copy mode)
- Add an optional `agentv eval --workspace-root <dir>` flag that sets a default working directory for **agentic** targets when the target config does not specify one.

## Non-goals
- Do not add a “skills loader” / marketplace installer / AGENTS.md rewriting system.
- Do not require any particular folder convention (skills are optional; sources can sync any folders).
- Do not add new provider types.
- Do not change default provider behavior unless `--workspace-root` is explicitly provided.
- Do not auto-modify user `targets.yaml`; instead provide CLI flag and/or sample snippet output.

## Impact
- Affected specs:
  - `eval-cli` (new optional flag affecting target resolution)
  - new `workspace-cli` capability (new commands + config file)
- Affected code (expected):
  - `apps/cli/src/cli.ts` (command registration)
  - `apps/cli/src/commands/workspace/*` (new)
  - `apps/cli/src/commands/eval/*` (flag plumbing)
  - `packages/core/src/evaluation/providers/targets.ts` (optional: only if we choose to inject workspace root at core target resolution)

## Compatibility
- Backward compatible: existing configs and command invocations continue working unchanged.
- `--workspace-root` is opt-in and only applies when a target does not already define `cwd` (or `workspaceTemplate` for VS Code).
