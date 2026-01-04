# Tasks: Add token usage evaluator

- [x] Update spec deltas (`yaml-schema`, `evaluation`)
- [x] Add `token_usage` evaluator config types
- [x] Parse `token_usage` in evaluator parser (validate limits)
- [x] Implement `TokenUsageEvaluator` (uses traceSummary.tokenUsage)
- [x] Ensure traceSummary includes tokenUsage even when output messages are absent (if provider reports usage)
- [x] Add unit tests for `TokenUsageEvaluator` and orchestrator propagation
- [x] Update schema reference files (`eval-schema.json`)
- [x] Add docs/reference examples and update skills references
- [x] Add changeset
- [x] Run `bun run build`, `bun run typecheck`, `bun run lint`, `bun test`

