# Tasks: Add Dataset Split Filtering

## 1. Core Implementation

- [ ] 1.1 Create `apps/cli/src/commands/eval/split-filter.ts` with `extractSplit` and `filterBySplit` functions
- [ ] 1.2 Add `--split` option to eval command in `apps/cli/src/commands/eval/index.ts`
- [ ] 1.3 Integrate split filtering into `resolveEvalPaths` function

## 2. Testing

- [ ] 2.1 Add tests for split pattern extraction (dash and underscore patterns)
- [ ] 2.2 Add tests for file filtering by split name
- [ ] 2.3 Add tests for error handling when no files match

## 3. Quality Assurance

- [ ] 3.1 Run `bun run build && bun run typecheck && bun run lint && bun test`
