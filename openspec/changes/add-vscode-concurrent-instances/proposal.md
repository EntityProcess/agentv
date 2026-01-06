# Change: Concurrent VS Code instances for eval workers

## Why
The VS Code provider currently forces a single worker because chat dispatch targets the last focused VS Code window, which can route prompts to the wrong workspace when multiple instances are open. This makes parallel evals unreliable and forces manual tracking of subagent workspaces.

## What Changes
- Add an opt-in VS Code target mode that launches isolated VS Code instances per worker to avoid focus races, with optional instance count control.
- Allow the eval CLI to run multiple workers for VS Code targets when isolation is enabled.
- Extend VS Code provider configuration to derive per-instance CLI arguments (user-data/extension dirs) and track instance usage.
- Update the subagent integration to accept VS Code CLI arguments for deterministic instance routing.

## Impact
- Affected specs: `openspec/specs/eval-cli/spec.md`, `openspec/specs/evaluation/spec.md`
- Affected code: `apps/cli/src/commands/eval/run-eval.ts`, `packages/core/src/evaluation/providers/vscode.ts`, `packages/core/src/evaluation/providers/targets.ts`, subagent integration
- Docs/templates: VS Code target docs and templates (skills/references) describing the new isolation mode
