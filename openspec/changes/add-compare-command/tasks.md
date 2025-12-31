# Tasks: Add Result Comparison Command

## 1. Core Implementation

- [x] 1.1 Create `apps/cli/src/commands/compare/index.ts` with CLI command and comparison logic
- [x] 1.2 Register compare command in `apps/cli/src/index.ts`

## 2. Testing

- [x] 2.1 Add tests for JSONL loading and result matching
- [x] 2.2 Add tests for win/loss/tie classification
- [x] 2.3 Add tests for exit code behavior

## 3. Quality Assurance

- [x] 3.1 Run `bun run build && bun run typecheck && bun run lint && bun test`
