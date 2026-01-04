# Change: Add token usage evaluator

## Why
Many targets reliably report token usage (`input`/`output`) even when dollar cost is unavailable or inconsistent across providers. We need a built-in evaluator to gate on token budgets alongside existing `latency` and `cost`.

## What Changes
- Add a new built-in evaluator type: `token_usage`
- Allow YAML configuration of token limits (`max_input`, `max_output`, `max_total`) with optional per-evaluator `weight`
- Ensure execution metrics (token usage) are available to evaluators consistently

## Non-Goals
- Estimating cost from token usage (provider/model specific)
- Per-tool token attribution

## Impact
- Affected specs: `yaml-schema`, `evaluation`
- Affected code (planned): `packages/core/src/evaluation/evaluators.ts`, `packages/core/src/evaluation/loaders/evaluator-parser.ts`, `packages/core/src/evaluation/types.ts`, `packages/core/src/evaluation/orchestrator.ts`
- Backward compatibility: Non-breaking; new evaluator is opt-in

