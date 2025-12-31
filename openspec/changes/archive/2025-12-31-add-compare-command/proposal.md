# Change: Add Result Comparison Command

## Why

Users need to evaluate effectiveness of different models, prompts, and configurations. Currently there's no built-in way to compare two evaluation runs.

## What Changes

- **Add `agentv compare` command**: Minimal comparison of two result files (JSONL)
  - Match results by `eval_id`
  - Compute score deltas
  - Classify wins/losses/ties based on configurable threshold
  - Output structured JSON (external tools handle formatting/analysis)
  - Exit code indicates comparison result for CI integration

## Impact

- Affected specs: `eval-cli`
- Affected code:
  - `apps/cli/src/index.ts` (register compare command)
  - `apps/cli/src/commands/compare/` (new directory)
