# Implementation Tasks

## 1. Dependencies

- [ ] 1.1 Add `p-limit` package to root `package.json`
- [ ] 1.2 Add `async-mutex` package to root `package.json`
- [ ] 1.3 Run `pnpm install` to update lockfile

## 2. Core Infrastructure

- [ ] 2.1 Update `packages/core/src/evaluation/providers/types.ts`:
  - [ ] 2.1.1 Add `workers?: number` to `TargetDefinition` interface
- [ ] 2.2 Update `packages/core/src/evaluation/providers/targets.ts`:
  - [ ] 2.2.1 Add `workers?: number` to `ResolvedTarget` union types
  - [ ] 2.2.2 Update `BASE_TARGET_SCHEMA` to include `workers: z.number().int().min(1).optional()`
  - [ ] 2.2.3 Parse and pass through `workers` in `resolveTargetDefinition`
- [ ] 2.3 Update `packages/core/src/evaluation/orchestrator.ts`:
  - [ ] 2.3.1 Import `pLimit` from `p-limit`
  - [ ] 2.3.2 Add `maxConcurrency?: number` to `RunEvaluationOptions`
  - [ ] 2.3.3 Resolve workers from options.maxConcurrency ?? target.workers ?? 1
  - [ ] 2.3.4 Create concurrency limiter: `const limit = pLimit(workers)`
  - [ ] 2.3.5 Map test cases with `limit(() => runTestCase(...))`
  - [ ] 2.3.6 Use `Promise.allSettled()` to wait for all limited promises
  - [ ] 2.3.7 Handle fulfilled and rejected promises separately
- [ ] 2.2 Update `apps/cli/src/commands/eval/output-writer.ts`:
  - [ ] 2.2.1 Import `Mutex` from `async-mutex`
  - [ ] 2.2.2 Add mutex instance to writer classes
  - [ ] 2.2.3 Wrap `append()` method with mutex acquire/release
  - [ ] 2.2.4 Ensure mutex is released even on errors (finally block)

## 3. CLI Integration

- [ ] 3.1 Update `apps/cli/src/commands/eval/index.ts`:
  - [ ] 3.1.1 Add `--workers <count>` option with parseInteger helper
  - [ ] 3.1.2 Don't set a default (use undefined to allow target override)
  - [ ] 3.1.3 Add help text describing parallel execution and target.yaml override
- [ ] 3.2 Update `apps/cli/src/commands/eval/run-eval.ts`:
  - [ ] 3.2.1 Extract `workers` from normalized options (may be undefined)
  - [ ] 3.2.2 Resolve workers priority: CLI flag > target.workers > 1
  - [ ] 3.2.3 Pass resolved `maxConcurrency` to `runEvaluation()` call
  - [ ] 3.2.4 Add validation (workers >= 1, reasonable max like 50)
  - [ ] 3.2.5 Log which source provided workers value in verbose mode

## 4. Testing

- [ ] 4.1 Add unit tests in `packages/core/test/evaluation/orchestrator.test.ts`:
  - [ ] 4.1.1 Test sequential execution (workers=1)
  - [ ] 4.1.2 Test parallel execution (workers=4)
  - [ ] 4.1.3 Test error handling in parallel mode
  - [ ] 4.1.4 Test partial failures (some workers succeed, some fail)
- [ ] 4.2 Add integration tests in `apps/cli/test/eval.integration.test.ts`:
  - [ ] 4.2.1 Test `--workers 1` produces same results as no flag
  - [ ] 4.2.2 Test `--workers 4` completes faster than sequential
  - [ ] 4.2.3 Test file writes are not corrupted with parallel writes
  - [ ] 4.2.4 Test statistics calculation with parallel execution

## 5. Documentation

- [ ] 5.1 Update `README.md`:
  - [ ] 5.1.1 Add `--workers` to command line options section
  - [ ] 5.1.2 Add examples showing parallel execution usage
  - [ ] 5.1.3 Document performance considerations
  - [ ] 5.1.4 Add warning about VS Code provider with parallel execution
- [ ] 5.2 Update `CHANGELOG.md`:
  - [ ] 5.2.1 Add entry for parallel execution feature
  - [ ] 5.2.2 Document backward compatibility (default unchanged)

## 6. Validation

- [ ] 6.1 Run full test suite: `pnpm test`
- [ ] 6.2 Run example evals with different worker counts
- [ ] 6.3 Verify JSONL output integrity with parallel writes
- [ ] 6.4 Benchmark sequential vs parallel execution
- [ ] 6.5 Test edge cases (workers > test cases, workers = 1, workers = 50)
