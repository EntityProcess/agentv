# Tasks: Add token usage evaluator

- [ ] Update spec deltas (`yaml-schema`, `evaluation`)
- [ ] Add `token_usage` evaluator config types
- [ ] Parse `token_usage` in evaluator parser (validate limits)
- [ ] Implement `TokenUsageEvaluator` (uses traceSummary.tokenUsage)
- [ ] Ensure traceSummary includes tokenUsage even when output messages are absent (if provider reports usage)
- [ ] Add unit tests for `TokenUsageEvaluator` and orchestrator propagation
- [ ] Update schema reference files (`eval-schema.json`)
- [ ] Add docs/reference examples and update skills references
- [ ] Add changeset
- [ ] Run `bun run build`, `bun run typecheck`, `bun run lint`, `bun test`

