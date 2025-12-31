# Change: Add Result Comparison Command

## Why

Users need to evaluate effectiveness of different models, prompts, and configurations. Currently there's no built-in way to compare two evaluation runs to determine which configuration performs better and whether the difference is statistically significant.

## What Changes

- **Add `agentv compare` command**: Compare two result files (JSONL) to analyze performance differences
  - Match results by `eval_id`
  - Compute wins/losses/ties based on configurable threshold
  - Statistical significance testing (Wilcoxon signed-rank test)
  - Effect size measurement (Cohen's d)
  - Output formats: table, JSON, markdown
  - Exit code indicates comparison result for CI integration
  - Delta visualization with directional indicators (↑↓→) and color coding
  - Show both absolute delta and percentage change
  - Compare cost/token metrics when available in results
  - Display run metadata differences (model, config) when available

## Impact

- Affected specs: `eval-cli`
- Affected code:
  - `apps/cli/src/index.ts` (register compare command)
  - `apps/cli/src/commands/compare/` (new directory)
