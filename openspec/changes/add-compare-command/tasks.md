# Tasks: Add Result Comparison Command

## 1. Core Implementation

- [ ] 1.1 Create `apps/cli/src/commands/compare/index.ts` with CLI command and comparison logic
- [ ] 1.2 Register compare command in `apps/cli/src/index.ts`

## 2. Testing

- [ ] 2.1 Add tests for JSONL loading and result matching
- [ ] 2.2 Add tests for win/loss/tie classification
- [ ] 2.3 Add tests for exit code behavior

## 3. Quality Assurance

- [ ] 3.1 Run `bun run build && bun run typecheck && bun run lint && bun test`
