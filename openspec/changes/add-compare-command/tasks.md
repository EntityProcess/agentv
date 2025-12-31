# Tasks: Add Result Comparison Command

## 1. Core Implementation

- [ ] 1.1 Create `apps/cli/src/commands/compare/types.ts` with comparison type definitions
- [ ] 1.2 Create `apps/cli/src/commands/compare/comparison.ts` with core comparison logic
- [ ] 1.3 Create `apps/cli/src/commands/compare/statistics.ts` with statistical functions
- [ ] 1.4 Create `apps/cli/src/commands/compare/formatters.ts` with output formatters (delta visualization, color coding)
- [ ] 1.5 Create `apps/cli/src/commands/compare/metadata.ts` with cost/token and run config comparison
- [ ] 1.6 Create `apps/cli/src/commands/compare/index.ts` with CLI command definition
- [ ] 1.7 Register compare command in `apps/cli/src/index.ts`

## 2. Testing

- [ ] 2.1 Add tests for JSONL loading and result matching
- [ ] 2.2 Add tests for win/loss/tie classification
- [ ] 2.3 Add tests for statistical significance computation
- [ ] 2.4 Add tests for output formatters (including delta arrows and colors)
- [ ] 2.5 Add tests for cost/token aggregation when metadata present
- [ ] 2.6 Add tests for graceful handling when metadata absent

## 3. Quality Assurance

- [ ] 3.1 Run `bun run build && bun run typecheck && bun run lint && bun test`
