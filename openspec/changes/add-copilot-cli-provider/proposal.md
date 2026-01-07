# Change: Add GitHub Copilot CLI provider

## Why
AgentV currently supports running agent-style evaluations via `provider: vscode` (VS Code) and `provider: codex` (Codex CLI), but it does not support the GitHub Copilot CLI package (`@github/copilot`). Teams that standardize on Copilot CLI (often via `npx -y @github/copilot`) cannot evaluate the same prompts/tasks in AgentV without custom wrappers.

This change adds a first-class `copilot-cli` provider so AgentV can invoke Copilot CLI directly and capture responses for evaluation.

## What Changes
- Add a new target provider kind: `copilot-cli` (GitHub Copilot CLI via `@github/copilot`).
- Add target configuration fields for Copilot CLI execution (command/executable, args, model, timeout, cwd, env).
- Implement provider execution by spawning the Copilot CLI process, piping a constructed prompt to stdin, and capturing the final assistant response from stdout.
- Persist provider artifacts (stdout/stderr and optional log-dir files) for debugging on failures.
- Update documentation/templates so `agentv init` guidance includes Copilot CLI targets.

## Non-Goals
- Do not add `gh copilot` (GitHub CLI subcommand) support in this change.
- Do not add interactive “resume session” UX; evaluations run as independent invocations.
- Do not introduce a new plugin system; this remains a built-in provider like `codex`/`vscode`.

## Impact
- Affected specs:
  - `evaluation` (new provider invocation behavior)
  - `validation` (targets schema/validation for the new provider)
- Affected code (implementation stage):
  - `packages/core/src/evaluation/providers/*` (new provider + provider registry)
  - `packages/core/src/evaluation/validation/targets-validator.ts`
  - `apps/cli` docs/templates (provider list + examples)

## Compatibility
- Backwards compatible: existing targets continue to work unchanged.
- `provider: copilot-cli` is additive.

## Decisions
- Canonical provider kind: `copilot-cli`.
- Accepted provider aliases: `copilot` and `github-copilot`.
- Output contract: unless/ until Copilot CLI exposes a stable machine-readable mode that AgentV supports, the provider treats Copilot CLI stdout as the candidate answer after stripping ANSI escapes and trimming surrounding whitespace.
